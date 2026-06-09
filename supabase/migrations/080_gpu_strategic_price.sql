-- 080_gpu_strategic_price.sql
-- 가격 콕핏 Phase 1: 전략가(strategic_price) 컬럼 신설 + audit action_type 확장
--
-- 목적:
--   콕핏 UI가 gpu_products.strategic_price_krw를 단일 전략 판매가 소스로 읽는다.
--   NULL이면 자동마진가(견적 기반 계산) 사용, 값이 있으면 전략가 우선 표시.
--   direct_prices(Tier3 수동가 is_current=true의 sell_price_krw)를 단일 전략가 컬럼으로
--   통합하기 위해 백필을 포함한다.
--
-- 관계 정리:
--   - gpu_products.strategic_price_krw : 콕핏 단일 전략가 SSOT (이 마이그레이션 신설)
--   - direct_prices                    : 과거 Tier3 수동 판매가 이력 보존 테이블 (변경 없음)
--   - 백필 방향: direct_prices.is_current=true → strategic_price_krw (있을 때만, 멱등)
--
-- 멱등성: IF NOT EXISTS / DO $$ EXISTS 가드 / pg_constraint EXISTS 가드
-- 기존 데이터 파괴: 없음 (신규 nullable 컬럼 추가 + 안전 백필만)
-- RLS: 신규 컬럼은 기존 service_role 쓰기 정책을 그대로 상속(추가 정책 불필요)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: gpu_products — 전략가 컬럼 4개 추가 (IF NOT EXISTS — 멱등)
-- ============================================================================
-- strategic_price_krw     : 콕핏에서 사람이 직접 지정한 판매가(KRW). NULL = 자동마진가 사용.
-- strategic_override_reason: 전략가 설정 이유 (예: "경쟁사 대응", "기간한정 프로모")
-- strategic_set_by        : 설정자 식별자 (auth.uid() 또는 이메일 — text 유지, 기존 audit 패턴)
-- strategic_set_at        : 마지막 전략가 설정 시각

ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS strategic_price_krw      numeric      NULL,
  ADD COLUMN IF NOT EXISTS strategic_override_reason text         NULL,
  ADD COLUMN IF NOT EXISTS strategic_set_by          text         NULL,
  ADD COLUMN IF NOT EXISTS strategic_set_at          timestamptz  NULL;

-- 전략가 조회용 부분 인덱스: 콕핏이 WHERE strategic_price_krw IS NOT NULL로 필터할 때 활용
CREATE INDEX IF NOT EXISTS idx_gpu_products_strategic_price
  ON gpu_products (strategic_price_krw)
  WHERE strategic_price_krw IS NOT NULL;

-- 전략가 최신순 정렬 지원 (cursor 페이지네이션: strategic_set_at, id)
CREATE INDEX IF NOT EXISTS idx_gpu_products_strategic_set_at
  ON gpu_products (strategic_set_at DESC, id)
  WHERE strategic_set_at IS NOT NULL;

COMMENT ON COLUMN gpu_products.strategic_price_krw IS
  '콕핏 전략 판매가(KRW). NULL이면 자동마진가 적용. '
  'direct_prices.is_current=true 의 sell_price_krw에서 초기 백필됨(080). '
  '이후 콕핏 UI가 이 컬럼을 단일 소스로 읽고 씀.';

COMMENT ON COLUMN gpu_products.strategic_override_reason IS
  '전략가 설정 이유 (자유 텍스트). 예: "경쟁사 대응", "기간한정 프로모"';

COMMENT ON COLUMN gpu_products.strategic_set_by IS
  '마지막 전략가를 설정한 사용자 식별자 (text — 기존 audit actor 패턴 동일)';

COMMENT ON COLUMN gpu_products.strategic_set_at IS
  '마지막 전략가 설정 시각 (timestamptz). 이력은 gpu_audit_logs strategic_price_set 이벤트로 관리.';


-- ============================================================================
-- STEP 2: direct_prices → strategic_price_krw 백필 (멱등 + 안전)
-- ============================================================================
-- 조건:
--   1. product_id가 gpu_products에 존재하는 경우만 (orphan 방지 — ON DELETE CASCADE이지만 명시)
--   2. direct_prices.is_current = true 인 최신 행 기준 (복수 행 존재 시 set_at 최신 1건)
--   3. gpu_products.strategic_price_krw IS NULL인 경우만 백필 (기존 값 덮어쓰기 금지)
--
-- 재실행 안전: strategic_price_krw IS NULL 조건이 멱등 가드 역할을 함.
-- 부작용 없음: direct_prices 테이블 변경 없음.

UPDATE gpu_products gp
SET
  strategic_price_krw       = dp_latest.sell_price_krw,
  strategic_set_by          = 'migration:080',
  strategic_set_at          = COALESCE(dp_latest.set_at, now()),
  strategic_override_reason = 'direct_prices 백필 (080 마이그레이션)'
FROM (
  -- is_current=true 중 product_id별 set_at 최신 1건만
  SELECT DISTINCT ON (product_id)
    product_id,
    sell_price_krw,
    set_at
  FROM direct_prices
  WHERE is_current = true
    AND deleted_at IS NULL       -- 078에서 추가된 소프트삭제 컬럼 반영
    AND sell_price_krw IS NOT NULL
    AND sell_price_krw > 0
  ORDER BY product_id, set_at DESC NULLS LAST
) dp_latest
WHERE gp.id = dp_latest.product_id
  AND gp.strategic_price_krw IS NULL;  -- 이미 값이 있는 행은 건드리지 않음


-- ============================================================================
-- STEP 3: gpu_audit_logs action_type CHECK 확장
-- ============================================================================
-- 079 패턴 동일: DROP IF EXISTS + ADD (기존 허용값 전부 유지 + 신규 1개)
-- 추가값: 'strategic_price_set' — 콕핏 전략가 설정/수정/삭제 이벤트

ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    -- 078 원본 허용값 (유지)
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    -- 079에서 추가된 값 (유지)
    'quote_supplier_assigned',
    'quote_edited',
    'quote_deleted',
    'product_created',
    'product_updated',
    'product_deleted',
    'direct_price_updated',
    'direct_price_deleted',
    'market_price_updated',
    'market_price_deleted',
    'availability_deleted',
    'pool_stock_deleted',
    -- 080 신규: 전략가 설정 이벤트
    'strategic_price_set'
  ]));


-- ============================================================================
-- STEP 4: 백필 감사 이벤트 기록 (멱등)
-- ============================================================================
-- 백필된 product에 한해 strategic_price_set 이벤트를 감사 로그에 삽입.
-- 재실행 시 중복 방지: detail->>'source' = 'migration:080' AND product_id 존재 체크.

INSERT INTO gpu_audit_logs (ts, actor, action_type, product_id, detail)
SELECT
  now(),
  'migration:080',
  'strategic_price_set',
  gp.id,
  jsonb_build_object(
    'source',              'migration:080',
    'backfill_from',       'direct_prices',
    'strategic_price_krw', gp.strategic_price_krw,
    'product_id',          gp.id
  )
FROM gpu_products gp
WHERE gp.strategic_set_by = 'migration:080'
  AND gp.strategic_price_krw IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gpu_audit_logs al
    WHERE al.action_type = 'strategic_price_set'
      AND al.detail->>'source' = 'migration:080'
      AND al.product_id = gp.id
  );


COMMIT;


-- ============================================================================
-- 롤백 스크립트 (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
-- ============================================================================
-- BEGIN;
--
-- -- STEP 4 감사 이벤트 제거
-- DELETE FROM gpu_audit_logs
--   WHERE action_type = 'strategic_price_set'
--     AND detail->>'source' = 'migration:080';
--
-- -- STEP 3 action_type CHECK를 079 상태로 복원
-- ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
-- ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
--   CHECK (action_type = ANY (ARRAY[
--     'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
--     'direct_set', 'margin_changed', 'rejected',
--     'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
--     'pool_stock_changed', 'availability_registered', 'inquiry_sent',
--     'nonstandard_backfill',
--     'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
--     'product_created', 'product_updated', 'product_deleted',
--     'direct_price_updated', 'direct_price_deleted',
--     'market_price_updated', 'market_price_deleted',
--     'availability_deleted', 'pool_stock_deleted'
--   ]));
--
-- -- STEP 2 백필 복원 (migration:080이 설정한 값만 NULL로 되돌림)
-- UPDATE gpu_products
--   SET
--     strategic_price_krw       = NULL,
--     strategic_override_reason = NULL,
--     strategic_set_by          = NULL,
--     strategic_set_at          = NULL
--   WHERE strategic_set_by = 'migration:080';
--
-- -- STEP 1 인덱스 + 컬럼 제거
-- DROP INDEX IF EXISTS idx_gpu_products_strategic_set_at;
-- DROP INDEX IF EXISTS idx_gpu_products_strategic_price;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS strategic_set_at;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS strategic_set_by;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS strategic_override_reason;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS strategic_price_krw;
--
-- COMMIT;
