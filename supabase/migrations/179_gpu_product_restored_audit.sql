-- =============================================================================
-- 179_gpu_product_restored_audit.sql
-- 모델(구성) 삭제 되돌리기(v0.7.405): gpu_audit_logs CHECK에 'product_restored' 추가.
-- 스펙관리 '모델 삭제'는 소프트삭제(deleted_at)라 되돌리기(복구)를 지원 —
-- 복구 이벤트를 감사에 남기려면 action_type CHECK 확장 필요(부분추가 불가 → 128 전체 보존 + 1개 추가).
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
    'review_bulk_confirmed', 'review_bulk_deleted',
    -- 179 신규: 소프트삭제 모델 되돌리기(복구)
    'product_restored',
    -- 179 선재버그 복구: competitor_merged가 128 CHECK에서 누락돼 병합 감사 INSERT가 조용히 실패 중이었음
    --   (audit.ts:37·competitors/merge/route.ts에서 사용). CHECK 재작성 기회에 함께 허용.
    'competitor_merged'
  ]));
