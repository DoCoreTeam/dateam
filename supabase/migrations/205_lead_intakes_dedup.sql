-- 205: 리드 인테이크 사본 제거 + 재발 차단
--
-- **왜**: 2026-05-26 엑셀 대량 들여오기가 네 번 실행돼 같은 원본 행이 4벌씩 들어왔다.
--   전체 1,517건 중 고유 원본은 378건 — 나머지 1,134건은 바이트 단위로 동일한 사본이다.
--   그 사본 때문에 인박스가 "1,514건 남음"이라고 말했고, 사람이 하나씩 볼 수 없는 큐가 됐다.
--
-- **되돌릴 수 있게 한다**: 지우기 전에 통째로 백업 테이블에 복사한다.
--   사용자가 "사본은 필요없다"고 확정했지만, 되돌릴 길을 남기지 않는 삭제는 하지 않는다.
--
-- **재발을 같이 막는다**: 멱등키가 없어서 네 번 돈 것이다.
--   (user_id, source, bulk_import_row) 부분 유니크를 걸면 다음 엑셀에서 같은 일이 안 생긴다.
--
-- ⚠️ 남길 행을 고르는 순서가 중요하다 — **이미 CRM 으로 이관된 행을 최우선으로 남긴다.**
--    그걸 지우면 crm_company 와의 연결(crm_company_id)이 끊긴다.

BEGIN;

-- ── 1. 백업 (되돌리기 경로) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_intakes_dup_backup_20260817 (
  LIKE lead_intakes INCLUDING DEFAULTS
);

COMMENT ON TABLE lead_intakes_dup_backup_20260817 IS
  '205 마이그레이션이 제거한 lead_intakes 사본. 되돌리려면 이 테이블에서 다시 INSERT 한다.';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, source, parsed_data->>'bulk_import_row'
           -- 이관된 행 우선(false < true) → 그 다음 먼저 들어온 순
           ORDER BY (crm_migrated_at IS NULL), created_at, id
         ) AS rn
  FROM lead_intakes
  WHERE parsed_data->>'bulk_import_row' IS NOT NULL
)
INSERT INTO lead_intakes_dup_backup_20260817
SELECT l.* FROM lead_intakes l
JOIN ranked r ON r.id = l.id
WHERE r.rn > 1
ON CONFLICT DO NOTHING;

-- ── 2. 사본 제거 ────────────────────────────────────────────────────────
-- 이관된 행은 어떤 경우에도 지우지 않는다(이중 방어 — 위 ORDER BY 가 이미 막지만
-- 순서 규칙이 나중에 바뀌어도 이 조건이 링크를 지킨다).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, source, parsed_data->>'bulk_import_row'
           ORDER BY (crm_migrated_at IS NULL), created_at, id
         ) AS rn
  FROM lead_intakes
  WHERE parsed_data->>'bulk_import_row' IS NOT NULL
)
DELETE FROM lead_intakes l
USING ranked r
WHERE r.id = l.id
  AND r.rn > 1
  AND l.crm_migrated_at IS NULL;

-- ── 3. 재발 차단 ────────────────────────────────────────────────────────
-- 부분 유니크: bulk_import_row 가 있는 행만 대상.
-- 수기 입력(prompt/file/card_scan/voice)에는 이 값이 없으므로 영향받지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_intakes_bulk_idem
  ON lead_intakes (user_id, source, (parsed_data->>'bulk_import_row'))
  WHERE parsed_data->>'bulk_import_row' IS NOT NULL;

-- ── 4. 거짓 상태값 정정 ─────────────────────────────────────────────────
-- status='crm_registered' 인데 연결된 레코드가 하나도 없는 행이 378건 있었다.
-- 그 상태값을 믿고 만든 판단은 전부 틀린다. 실제 상태인 'completed' 로 되돌린다.
UPDATE lead_intakes
   SET status = 'completed', updated_at = now()
 WHERE status = 'crm_registered'
   AND crm_company_id IS NULL
   AND linked_account_id IS NULL
   AND crm_migrated_at IS NULL;

COMMIT;
