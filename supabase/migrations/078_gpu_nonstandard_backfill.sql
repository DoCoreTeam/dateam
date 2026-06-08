-- 078_gpu_nonstandard_backfill.sql
-- Sprint A: 비표준 gpu_count 정규화 + 소프트삭제 컬럼 준비 + 제약 강화
--
-- 대상 테이블: supply_quotes, gpu_products
-- 보조: 6개 테이블 deleted_at 추가 (Sprint C 소프트삭제 준비)
-- 정책 근거: .ralph/decisions/DECISION-20260608-x3-policy.md
--   표준 사다리 = {1, 2, 4, 8}
--   올림 규칙: 3→4, 5/6/7→8, 9+→8(최대단 클램프)
--   원본 비표준 행: quarantine 플래그로 보존(삭제 금지)
--   가격 환산: 앱단(per_gpu_usd GENERATED 컬럼)이 자동 처리
--
-- 멱등성: IF NOT EXISTS / DO $$ EXISTS 가드 / ON CONFLICT DO NOTHING
-- 실행 안전: 단일 트랜잭션 — 백필 완료 후 CHECK 제약 추가
-- 롤백: 이 파일 하단 "롤백 스크립트" 참조
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: 진단 주석 — 적용 전 비표준 분포 확인 (실행하지 않음, 참고용)
-- ============================================================================
-- 아래 쿼리를 별도로 실행하여 백필 범위를 사전 파악:
--
--   -- supply_quotes 비표준 분포
--   SELECT
--     gpu_count,
--     count(*) AS row_count,
--     string_agg(DISTINCT status, ', ') AS statuses
--   FROM supply_quotes
--   WHERE gpu_count NOT IN (1, 2, 4, 8)
--   GROUP BY gpu_count
--   ORDER BY gpu_count;
--
--   -- gpu_products 비표준 분포
--   SELECT
--     gpu_count,
--     count(*) AS row_count,
--     string_agg(DISTINCT model_name, ', ' ORDER BY model_name) AS models
--   FROM gpu_products
--   WHERE gpu_count NOT IN (1, 2, 4, 8)
--   GROUP BY gpu_count
--   ORDER BY gpu_count;
--
-- 해석 방법:
--   row_count = 0  → 해당 비표준 값 없음, STEP 2 백필은 무해하게 실행됨
--   row_count > 0  → 백필 대상. statuses에 'confirmed'가 포함되면
--                     CHECK 제약(STEP 5) 추가 전 백필이 선행되므로 안전.
--                    'confirmed' 행이 많을 경우 서비스 중단 없이 적용 가능
--                    (UPDATE는 행 단위 잠금, 견적 조회에 영향 없음).
-- ============================================================================


-- ============================================================================
-- STEP 1: 추적 컬럼 추가 (IF NOT EXISTS — 멱등)
-- ============================================================================

-- raw_gpu_count: 원본 비표준 값 보존 (백필 전 값). 표준 행은 NULL 유지.
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS raw_gpu_count int;

-- is_nonstandard_source: 비표준 원본에서 백필된 행 마킹
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS is_nonstandard_source boolean NOT NULL DEFAULT false;

-- gpu_products에도 동일 추적 컬럼
ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS raw_gpu_count int;

ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS is_nonstandard_source boolean NOT NULL DEFAULT false;


-- ============================================================================
-- STEP 2: supply_quotes 비표준 행 원본 보존 + 마킹
-- ============================================================================
-- NOTE: per_gpu_usd는 GENERATED ALWAYS AS (unit_price_usd / NULLIF(gpu_count, 0)) STORED
--       이므로 gpu_count 변경 시 자동 재계산됨. 직접 UPDATE 불가(정상).
--       즉 gpu_count를 올림으로 바꾸면 per_gpu_usd = 총가 / 새 표준 장수 가 되어
--       가격이 희석될 수 있음. DECISION에서 "1장 환산은 앱단 처리"라고 명시했으므로,
--       DB에는 원본 unit_price_usd(총가)를 보존하고 per_gpu_usd의 앱단 해석은
--       buildCatalog()의 bestPerGpuByModel 로직이 담당한다.
--       따라서 여기서는 gpu_count만 표준단으로 올림 처리한다.

UPDATE supply_quotes
SET
  raw_gpu_count          = gpu_count,          -- 원본 값 보존
  is_nonstandard_source  = true,               -- quarantine 마킹
  gpu_count = CASE
    WHEN gpu_count = 3             THEN 4
    WHEN gpu_count IN (5, 6, 7)    THEN 8
    WHEN gpu_count >= 9            THEN 8
    ELSE gpu_count  -- 이 분기는 WHERE 조건으로 걸러지지만 안전장치
  END
WHERE gpu_count NOT IN (1, 2, 4, 8);


-- ============================================================================
-- STEP 3: gpu_products 비표준 행 원본 보존 + 백필
-- ============================================================================
-- NOTE: gpu_products는 UNIQUE(model_name, memory, gpu_count, vcpu, tier) 제약이 있음(025).
--       비표준 행을 표준단(예: 3→4)으로 올릴 때 동일 (model_name, memory, 4, vcpu, tier) 행이
--       이미 존재할 수 있음. 이 경우 UPDATE는 UNIQUE 위반으로 실패한다.
--
--       처리 전략:
--         ① 충돌 없는 행: 직접 UPDATE
--         ② 충돌 있는 행(표준 행 이미 존재): raw_gpu_count + is_nonstandard_source만 마킹하고
--            gpu_count는 그대로 둠 — 해당 비표준 행은 quarantine 상태로 남고
--            신규 CHECK 제약에서 NOT VALID로 처리하여 향후 수동 정리 안내.
--
--       이 때문에 STEP 5의 gpu_products CHECK는 NOT VALID로 추가한다(아래 참조).

-- ② 충돌 없는 행 업데이트
UPDATE gpu_products
SET
  raw_gpu_count         = gpu_count,
  is_nonstandard_source = true,
  gpu_count = CASE
    WHEN gpu_count = 3             THEN 4
    WHEN gpu_count IN (5, 6, 7)    THEN 8
    WHEN gpu_count >= 9            THEN 8
    ELSE gpu_count
  END
WHERE gpu_count NOT IN (1, 2, 4, 8)
  AND NOT EXISTS (
    -- 올림 대상 표준단과 충돌하는 행이 없는 경우만 UPDATE
    SELECT 1 FROM gpu_products conflict
    WHERE conflict.model_name = gpu_products.model_name
      AND conflict.memory     = gpu_products.memory
      AND conflict.vcpu       = gpu_products.vcpu
      AND conflict.tier       = gpu_products.tier
      AND conflict.id        != gpu_products.id
      AND conflict.gpu_count  = CASE
            WHEN gpu_products.gpu_count = 3             THEN 4
            WHEN gpu_products.gpu_count IN (5, 6, 7)    THEN 8
            WHEN gpu_products.gpu_count >= 9             THEN 8
            ELSE gpu_products.gpu_count
          END
  );

-- ③ 충돌로 인해 gpu_count를 못 바꾼 행: is_nonstandard_source만 마킹 (원본 식별용)
UPDATE gpu_products
SET
  raw_gpu_count         = gpu_count,
  is_nonstandard_source = true
WHERE gpu_count NOT IN (1, 2, 4, 8)
  AND is_nonstandard_source = false;  -- 위 UPDATE에서 이미 처리된 행 제외


-- ============================================================================
-- STEP 4: 소프트삭제 컬럼 추가 (Sprint C 대비 — 6개 테이블)
-- ============================================================================
-- 모든 컬럼: NULL 허용(삭제 전 = NULL, 삭제 = 타임스탬프)
-- 기존 데이터 영향 없음(NULL DEFAULT)

ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE direct_prices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- availability_responses: 031에서 생성
ALTER TABLE availability_responses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- direct_pool_stock: 030에서 생성
ALTER TABLE direct_pool_stock
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- market_prices: 065_schema_digest_autoscan에서 COMMENT 참조됨
-- 실제 DDL이 마이그레이션 파일에 없으면 아래 실행 시 "relation does not exist" 오류 발생.
-- 오류 발생 시: 이 블록을 제거하고 market_prices DDL 생성 마이그레이션 이후에 적용할 것.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'market_prices'
  ) THEN
    ALTER TABLE market_prices
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  END IF;
END $$;

-- 소프트삭제 인덱스 (Sprint C에서 WHERE deleted_at IS NULL 필터 사용 전제)
CREATE INDEX IF NOT EXISTS idx_supply_quotes_not_deleted
  ON supply_quotes (product_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gpu_products_not_deleted
  ON gpu_products (model_name, gpu_count) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_prices_not_deleted
  ON direct_prices (product_id, is_current) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_availability_responses_not_deleted
  ON availability_responses (product_id, is_current) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_pool_stock_not_deleted
  ON direct_pool_stock (product_id, is_current) WHERE deleted_at IS NULL;


-- ============================================================================
-- STEP 5: 표준단 CHECK 제약 추가
-- ============================================================================
-- supply_quotes: STEP 2 백필 후 비표준 행 0건 보장 → VALID CHECK 추가 가능
-- 단, 재실행 안전을 위해 pg_constraint EXISTS 가드 사용

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supply_quotes_gpu_count_standard'
  ) THEN
    ALTER TABLE supply_quotes
      ADD CONSTRAINT supply_quotes_gpu_count_standard
        CHECK (gpu_count IN (1, 2, 4, 8));
  END IF;
END $$;

-- gpu_products: STEP 3에서 충돌로 인해 비표준 행이 잔존할 수 있음 → NOT VALID로 추가
-- NOT VALID: 신규 INSERT/UPDATE는 제약 적용, 기존 행은 검사 안 함(잔존 비표준 행 허용)
-- VALIDATE CONSTRAINT는 수동으로 잔존 비표준 행 정리 후 실행:
--   ALTER TABLE gpu_products VALIDATE CONSTRAINT gpu_products_gpu_count_standard;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gpu_products_gpu_count_standard'
  ) THEN
    ALTER TABLE gpu_products
      ADD CONSTRAINT gpu_products_gpu_count_standard
        CHECK (gpu_count IN (1, 2, 4, 8)) NOT VALID;
  END IF;
END $$;


-- ============================================================================
-- STEP 6: gpu_audit_logs — 비표준 백필 감사 이벤트 기록
-- ============================================================================
-- 기존 gpu_audit_logs 스키마(024_gpu_pricing.sql):
--   id uuid, ts timestamptz, actor text, action_type text (CHECK 목록), product_id uuid, detail jsonb, evidence_ref text
-- action_type CHECK(032_audit_action_types.sql)에 'nonstandard_backfill' 추가 후 이벤트 INSERT
--
-- NOTE: gpu_audit_logs.actor 는 text(NOT uuid). 기존 스키마 그대로 사용.

-- action_type 허용 목록에 'nonstandard_backfill' 추가
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill'   -- Sprint A: 비표준 gpu_count 백필 감사
  ]));

-- supply_quotes 백필 감사 이벤트 삽입 (멱등: 이미 기록된 경우 스킵)
INSERT INTO gpu_audit_logs (ts, actor, action_type, product_id, detail)
SELECT
  now(),
  'migration:078',
  'nonstandard_backfill',
  sq.product_id,
  jsonb_build_object(
    'table',          'supply_quotes',
    'quote_id',       sq.id,
    'raw_gpu_count',  sq.raw_gpu_count,
    'new_gpu_count',  sq.gpu_count,
    'backfill_rule',  CASE
                        WHEN sq.raw_gpu_count = 3             THEN '3→4'
                        WHEN sq.raw_gpu_count IN (5, 6, 7)    THEN '5-7→8'
                        WHEN sq.raw_gpu_count >= 9             THEN '9+→8'
                        ELSE 'unknown'
                      END
  )
FROM supply_quotes sq
WHERE sq.is_nonstandard_source = true
  AND sq.raw_gpu_count IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gpu_audit_logs al
    WHERE al.action_type = 'nonstandard_backfill'
      AND al.detail->>'quote_id' = sq.id::text
  );

-- gpu_products 백필 감사 이벤트 삽입
INSERT INTO gpu_audit_logs (ts, actor, action_type, product_id, detail)
SELECT
  now(),
  'migration:078',
  'nonstandard_backfill',
  gp.id,
  jsonb_build_object(
    'table',          'gpu_products',
    'product_id',     gp.id,
    'model_name',     gp.model_name,
    'raw_gpu_count',  gp.raw_gpu_count,
    'new_gpu_count',  gp.gpu_count,
    'note',           CASE
                        WHEN gp.gpu_count = gp.raw_gpu_count THEN 'collision_kept_raw'
                        ELSE 'backfilled'
                      END
  )
FROM gpu_products gp
WHERE gp.is_nonstandard_source = true
  AND gp.raw_gpu_count IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gpu_audit_logs al
    WHERE al.action_type = 'nonstandard_backfill'
      AND al.detail->>'product_id' = gp.id::text
  );


-- ============================================================================
-- STEP 7: 비표준 식별 인덱스 (쿼리 성능)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_supply_quotes_nonstandard
  ON supply_quotes (is_nonstandard_source) WHERE is_nonstandard_source = true;

CREATE INDEX IF NOT EXISTS idx_gpu_products_nonstandard
  ON gpu_products (is_nonstandard_source) WHERE is_nonstandard_source = true;


COMMIT;


-- ============================================================================
-- 롤백 스크립트 (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
-- ============================================================================
-- BEGIN;
--
-- -- STEP 7 인덱스
-- DROP INDEX IF EXISTS idx_supply_quotes_nonstandard;
-- DROP INDEX IF EXISTS idx_gpu_products_nonstandard;
--
-- -- STEP 6 감사 이벤트 제거 + action_type 제약 복원
-- DELETE FROM gpu_audit_logs WHERE action_type = 'nonstandard_backfill';
-- ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
-- ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
--   CHECK (action_type = ANY (ARRAY[
--     'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
--     'direct_set', 'margin_changed', 'rejected',
--     'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
--     'pool_stock_changed', 'availability_registered', 'inquiry_sent'
--   ]));
--
-- -- STEP 5 CHECK 제약
-- ALTER TABLE supply_quotes DROP CONSTRAINT IF EXISTS supply_quotes_gpu_count_standard;
-- ALTER TABLE gpu_products  DROP CONSTRAINT IF EXISTS gpu_products_gpu_count_standard;
--
-- -- STEP 4 소프트삭제 인덱스 + 컬럼
-- DROP INDEX IF EXISTS idx_supply_quotes_not_deleted;
-- DROP INDEX IF EXISTS idx_gpu_products_not_deleted;
-- DROP INDEX IF EXISTS idx_direct_prices_not_deleted;
-- DROP INDEX IF EXISTS idx_availability_responses_not_deleted;
-- DROP INDEX IF EXISTS idx_direct_pool_stock_not_deleted;
-- ALTER TABLE supply_quotes         DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE gpu_products          DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE direct_prices         DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE availability_responses DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE direct_pool_stock     DROP COLUMN IF EXISTS deleted_at;
--
-- -- STEP 2 & 3 백필 복원 (raw_gpu_count → gpu_count)
-- UPDATE supply_quotes
--   SET gpu_count = raw_gpu_count, raw_gpu_count = NULL, is_nonstandard_source = false
--   WHERE is_nonstandard_source = true AND raw_gpu_count IS NOT NULL;
--
-- UPDATE gpu_products
--   SET gpu_count = raw_gpu_count, raw_gpu_count = NULL, is_nonstandard_source = false
--   WHERE is_nonstandard_source = true AND raw_gpu_count IS NOT NULL;
--
-- -- STEP 1 추적 컬럼
-- ALTER TABLE supply_quotes DROP COLUMN IF EXISTS raw_gpu_count;
-- ALTER TABLE supply_quotes DROP COLUMN IF EXISTS is_nonstandard_source;
-- ALTER TABLE gpu_products  DROP COLUMN IF EXISTS raw_gpu_count;
-- ALTER TABLE gpu_products  DROP COLUMN IF EXISTS is_nonstandard_source;
--
-- COMMIT;
