-- =============================================================================
-- 124_lowest_quotes_no_expiry.sql
-- 공급가 "만료" 제거(v0.7.226): v_lowest_quotes에서 valid_until 날짜 필터 제거.
-- 기존(043): WHERE status='confirmed' AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
--   → 만료(valid_until < 오늘) 견적이 최저가 후보에서 제외되어 공급사 목록/공개 API에서 사라짐.
-- 변경: 공급가는 영속 원가기준 — 확정(confirmed) 견적이면 만료 여부 무관하게 포함.
--   (가격결정 콕핏은 buildCatalog가 supply_quotes를 직접 읽으므로 이 뷰와 독립 — 별도 코드 수정)
-- 비파괴: 뷰 교체만. valid_until 컬럼은 보존(정보·재도입 대비).
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
  ORDER BY product_id, unit_price_usd;
