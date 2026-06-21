-- =============================================================================
-- 128_audit_bulk_action_types.sql
-- 일괄 처리 감사 action_type 추가(v0.7.238): gpu_audit_logs CHECK에
--   'review_bulk_confirmed'(신규 일괄 확정) + 'review_bulk_deleted'(기존 일괄 삭제 — CHECK 누락으로 그동안 조용히 거부되던 것)
-- 을 허용. CHECK는 부분추가 불가 → 092 전체 목록 보존 + 2개 추가로 재정의.
-- =============================================================================
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
    'product_created', 'product_updated', 'product_deleted',
    'direct_price_updated', 'direct_price_deleted',
    'market_price_updated', 'market_price_deleted',
    'availability_deleted', 'pool_stock_deleted',
    'strategic_price_set',
    'gcube_price_collected',
    'market_cost_ingested',
    'gcube_reflected',
    'quote_selected', 'quote_deselected',
    -- 128 신규: 일괄 확정/삭제 요약 감사 (CHECK 누락 시 INSERT 조용히 실패)
    'review_bulk_confirmed', 'review_bulk_deleted'
  ]));
