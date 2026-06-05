-- 063: 데이터 품질 진단 함수 성능 인덱스 (DC-REV L-3). 부분 인덱스로 확정/대기 행만 색인.
CREATE INDEX IF NOT EXISTS idx_supply_quotes_confirmed ON supply_quotes(status, product_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS idx_review_items_pending ON review_items(status, product_hint) WHERE status='pending';
