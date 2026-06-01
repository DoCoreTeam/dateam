-- =============================================================================
-- 043_lowest_quotes_valid_until_null.sql
-- v_lowest_quotes: valid_until이 NULL(무기한)인 확정 견적도 포함
-- 기존: valid_until >= CURRENT_DATE → NULL이면 제외되어 가격표 미표시 버그
-- =============================================================================
CREATE OR REPLACE VIEW v_lowest_quotes AS
  SELECT DISTINCT ON (product_id)
    product_id,
    id AS quote_id,
    supplier_id,
    unit_price_usd,
    valid_until
  FROM supply_quotes
  WHERE status = 'confirmed'
    AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
  ORDER BY product_id, unit_price_usd;
