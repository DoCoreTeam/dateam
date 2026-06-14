-- 091_gcube_reflected.sql
-- gcube 가격 워크플로 P2: "홈페이지 반영 완료" 추적
--
-- 의미 분리:
--   '반영'      = 전략가(strategic_price_krw) 확정 = gcube 목표가 설정 (P1, 080에서 구현됨)
--   '반영 완료' = 실제 gcube.ai 홈페이지를 바꿨다는 수동 마킹 (이 마이그레이션, P2 신규)
--
-- 신규 컬럼(gpu_products):
--   gcube_reflected_at        : 홈페이지 반영 완료 마킹 시각
--   gcube_reflected_by        : 반영 완료를 마킹한 사용자(text — 기존 audit actor 패턴 동일)
--   gcube_reflected_price_krw : 반영 당시 전략가(또는 자동가) 스냅샷(KRW). 어느 가격을 반영했는지 박제.
--
-- audit action_type 'gcube_reflected' CHECK 확장 (080/081 패턴 그대로).
--
-- 멱등성: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD
-- 기존 데이터 파괴: 없음 (신규 nullable 컬럼 추가만, 백필 없음)
-- RLS: 신규 컬럼은 기존 service_role 쓰기 정책을 그대로 상속(추가 정책 불필요)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: gpu_products — 반영 완료 추적 컬럼 3개 추가 (IF NOT EXISTS — 멱등)
-- ============================================================================
ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS gcube_reflected_at        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS gcube_reflected_by        text        NULL,
  ADD COLUMN IF NOT EXISTS gcube_reflected_price_krw bigint      NULL;

COMMENT ON COLUMN gpu_products.gcube_reflected_at IS
  '실제 gcube.ai 홈페이지에 가격을 반영 완료했다고 수동 마킹한 시각. NULL이면 미반영.';
COMMENT ON COLUMN gpu_products.gcube_reflected_by IS
  '홈페이지 반영 완료를 마킹한 사용자 식별자(text — 기존 audit actor 패턴 동일).';
COMMENT ON COLUMN gpu_products.gcube_reflected_price_krw IS
  '반영 완료 마킹 당시의 목표가(전략가 또는 자동마진가) 스냅샷(KRW). 어느 가격을 반영했는지 박제.';

-- 미반영/반영됨 필터 및 최신순 조회 지원
CREATE INDEX IF NOT EXISTS idx_gpu_products_gcube_reflected_at
  ON gpu_products (gcube_reflected_at DESC, id)
  WHERE gcube_reflected_at IS NOT NULL;

-- ============================================================================
-- STEP 2: gpu_audit_logs action_type CHECK 확장
-- ============================================================================
-- 080/081 패턴 동일: DROP IF EXISTS + ADD (기존 허용값 전부 유지 + 신규 'gcube_reflected')
-- 081에서 추가된 'gcube_price_collected', 083에서 추가된 'market_cost_ingested'까지 모두 보존.

ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    -- 078 원본 허용값
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    -- 079 추가
    'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
    'product_created', 'product_updated', 'product_deleted',
    'direct_price_updated', 'direct_price_deleted',
    'market_price_updated', 'market_price_deleted',
    'availability_deleted', 'pool_stock_deleted',
    -- 080 추가
    'strategic_price_set',
    -- 081 추가
    'gcube_price_collected',
    -- 083 추가
    'market_cost_ingested',
    -- 091 신규: 홈페이지 반영 완료 마킹
    'gcube_reflected'
  ]));

COMMIT;


-- ============================================================================
-- 롤백 스크립트 (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
-- ============================================================================
-- BEGIN;
--
-- -- STEP 2 action_type CHECK를 083 상태로 복원 ('gcube_reflected' 제거)
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
--     'availability_deleted', 'pool_stock_deleted',
--     'strategic_price_set', 'gcube_price_collected', 'market_cost_ingested'
--   ]));
--
-- -- STEP 1 인덱스 + 컬럼 제거
-- DROP INDEX IF EXISTS idx_gpu_products_gcube_reflected_at;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_reflected_price_krw;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_reflected_by;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_reflected_at;
--
-- COMMIT;
