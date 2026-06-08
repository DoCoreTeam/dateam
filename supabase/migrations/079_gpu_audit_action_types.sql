-- 079_gpu_audit_action_types.sql
-- Sprint C: gpu_audit_logs action_type CHECK 허용값 확장
--
-- 신규 허용값 추가:
--   quote_supplier_assigned — 이미 사용 중이었으나 제약에 누락
--   quote_edited            — 이미 사용 중이었으나 제약에 누락
--   product_created         — C1 products POST
--   product_updated         — C1 products PATCH (확장)
--   product_deleted         — C2 products 소프트삭제
--   direct_price_updated    — C3 direct-prices PATCH audit
--   direct_price_deleted    — C2 direct-prices 소프트삭제
--   market_price_updated    — C3 market/prices PATCH
--   market_price_deleted    — C2 market/prices 소프트삭제
--   availability_deleted    — C2 availability 소프트삭제
--   pool_stock_deleted      — C2 pool-stock 소프트삭제
--
-- 멱등성: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- ============================================================================

BEGIN;

-- gpu_audit_logs action_type CHECK 확장
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    -- 078 허용값 (유지)
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    -- 이미 사용 중이었으나 누락됐던 값
    'quote_supplier_assigned',
    'quote_edited',
    'quote_deleted',
    -- Sprint C 신규
    'product_created',
    'product_updated',
    'product_deleted',
    'direct_price_updated',
    'direct_price_deleted',
    'market_price_updated',
    'market_price_deleted',
    'availability_deleted',
    'pool_stock_deleted'
  ]));

COMMIT;
