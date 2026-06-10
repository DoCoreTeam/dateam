-- =============================================================================
-- 082: 전 모델 표준 사다리 백필 + A100 x8 중복 정리
-- =============================================================================
-- 목적:
--   1. 현재 x1만 있는 모델들에 x2/x4/x8 gpu_products 행 생성 (표준 사다리 완성)
--   2. A100 x8 중복 2건(640GB / 320GB) 중 비표준 640GB를 soft-delete
--
-- 멱등 보장:
--   - INSERT는 ON CONFLICT (model_name, memory, gpu_count, vcpu, tier) DO NOTHING
--   - soft-delete는 WHERE deleted_at IS NULL 가드
--   - 재실행 시 어떤 변경도 발생하지 않음
--
-- 사전 조사 결과 (2026-06-10):
--   - 77개 모델 중 이미 {1,2,4,8} 완성: A100, B200, H100
--   - T4: {1,2} 보유 → x4/x8 누락
--   - V100: {1,2,4} 보유 → x8 누락
--   - 나머지 72개 모델: x1만 → x2/x4/x8 3개씩 누락
--   - 예상 INSERT 건수: 72×3 + 1(T4 x4) + 1(T4 x8) + 1(V100 x8) = 219건
--
-- A100 x8 중복 정본 판정:
--   - 320GB (id=dfb5e4e4): A100 x1(40GB)의 선형 ×8 = 320GB → 표준 정본
--   - 640GB (id=7043dfc3): 40GB×8 초과, 비표준 메모리 구성 → soft-delete 대상
--   - 양쪽 모두 supply_quotes 1건씩 보유
--   - 640GB 견적은 데이터 손실 없이 보존됨 (soft-delete는 product 행만, 견적 행 유지)
--
-- 롤백 노트:
--   - 이 마이그레이션은 INSERT + UPDATE(soft-delete)만 수행 — DROP/ALTER 없음
--   - 롤백 시:
--       UPDATE gpu_products SET deleted_at = NULL WHERE id = '7043dfc3-9200-4a5a-b74b-72a3de7a8408';
--       DELETE FROM gpu_products WHERE id IN (SELECT id FROM gpu_products
--         WHERE created_at >= <이 마이그 적용 시각> AND is_nonstandard_source = false
--         AND gpu_count IN (2,4,8));
--   - 앱 영향: 새로 생성된 x2/x4/x8 행은 supply_quotes가 없으므로
--     buildCatalog가 "견적 대기" 상태로 표시함 — 의도된 동작
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 1: 전 모델 표준 사다리 백필
-- ---------------------------------------------------------------------------
-- 059 마이그레이션과 동일한 패턴을 사용.
-- base: 각 model_name의 가장 작은 gpu_count 행 (deleted_at IS NULL)
-- scale: {1,2,4,8} 중 해당 model_name에 아직 없는 gpu_count만 INSERT
-- ---------------------------------------------------------------------------

INSERT INTO gpu_products (
  model_name, tier, pricing_mode, gpu_count, series,
  memory, vcpu, ram_gb, storage_gb
)
SELECT
  b.model_name,
  b.tier,
  'quote',
  s.n,
  b.series,
  -- memory: "NNN단위" 형식에서 숫자 추출 → per-GPU 환산 → ×n 후 단위 복원
  CASE
    WHEN b.memory ~ '[0-9]'
    THEN round(
           (regexp_replace(b.memory, '[^0-9]', '', 'g'))::numeric
           / greatest(b.gpu_count, 1)
           * s.n
         )::text
         || regexp_replace(b.memory, '[0-9]', '', 'g')  -- 단위 문자열(GB 등) 복원
    ELSE b.memory
  END,
  -- vcpu: per-GPU 단위로 선형 스케일
  round(b.vcpu::numeric / greatest(b.gpu_count, 1) * s.n)::int,
  -- ram_gb: per-GPU 단위로 선형 스케일
  round(b.ram_gb::numeric / greatest(b.gpu_count, 1) * s.n)::int,
  -- storage_gb: per-GPU 단위로 선형 스케일 (NULL이면 NULL 유지)
  CASE
    WHEN b.storage_gb IS NOT NULL
    THEN round(b.storage_gb::numeric / greatest(b.gpu_count, 1) * s.n)::int
    ELSE NULL
  END
FROM (
  -- 각 model_name의 가장 작은 gpu_count 행을 기준(base)으로 사용
  SELECT DISTINCT ON (model_name)
    model_name, tier, series, memory, gpu_count, vcpu, ram_gb, storage_gb
  FROM gpu_products
  WHERE deleted_at IS NULL
  ORDER BY model_name, gpu_count ASC
) b
CROSS JOIN (SELECT unnest(ARRAY[1, 2, 4, 8]) AS n) s
WHERE
  -- 해당 model_name + gpu_count 조합이 아직 없을 때만 (soft-deleted 포함하지 않음)
  NOT EXISTS (
    SELECT 1
    FROM gpu_products g
    WHERE g.model_name = b.model_name
      AND g.gpu_count  = s.n
      AND g.deleted_at IS NULL
  )
ON CONFLICT (model_name, memory, gpu_count, vcpu, tier) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 2: A100 x8 중복 정리 — 비표준 640GB soft-delete
-- ---------------------------------------------------------------------------
-- 정본:  dfb5e4e4-b69e-4058-bb95-36b7b878ebd7 (320GB, vcpu=124) — x1(40GB)의 ×8 선형 스케일
-- 삭제:  7043dfc3-9200-4a5a-b74b-72a3de7a8408 (640GB, vcpu=240) — 비표준(40GB×8=320GB 초과)
--
-- 참고:
--   · 두 행 모두 supply_quotes 1건씩 보유 (confirmed 상태, 견적 행은 삭제 안 함)
--   · soft-delete 후 640GB 견적은 고아 상태가 되나 데이터는 보존됨
--   · 필요 시 해당 견적을 정본(320GB) product_id로 수동 재연결 가능
-- ---------------------------------------------------------------------------

UPDATE gpu_products
SET deleted_at = now()
WHERE id = '7043dfc3-9200-4a5a-b74b-72a3de7a8408'
  AND deleted_at IS NULL;  -- 멱등: 이미 삭제된 경우 재실행 안전

COMMIT;

-- =============================================================================
-- 진단 쿼리 (적용 전후 비교용 — 실행만, 결과는 확인 후 폐기)
-- =============================================================================

-- [적용 후] 모델별 보유 단 현황
/*
SELECT
  model_name,
  array_agg(DISTINCT gpu_count ORDER BY gpu_count) AS gpu_counts,
  count(*)                                          AS row_cnt
FROM gpu_products
WHERE deleted_at IS NULL
GROUP BY model_name
ORDER BY model_name;
*/

-- [적용 후] 아직 x1 없는 모델 (있으면 이상)
/*
SELECT model_name
FROM gpu_products
WHERE deleted_at IS NULL
GROUP BY model_name
HAVING NOT (1 = ANY(array_agg(gpu_count)));
*/

-- [적용 후] A100 x8 현황 (정본 1건만 남아야 함)
/*
SELECT id, model_name, memory, gpu_count, vcpu, deleted_at
FROM gpu_products
WHERE model_name = 'A100' AND gpu_count = 8
ORDER BY deleted_at NULLS FIRST;
*/

-- [적용 후] 전체 백필 건수 확인 (082 이후 생성된 비기존 행)
/*
SELECT count(*) AS backfilled_rows
FROM gpu_products
WHERE created_at >= (
  SELECT min(created_at) FROM gpu_products
  -- 실제 적용 시각으로 교체하여 사용
  -- 예: WHERE created_at >= '2026-06-10 00:00:00+00'
);
*/
