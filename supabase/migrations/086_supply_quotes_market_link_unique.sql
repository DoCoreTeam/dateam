-- 086: 인입 cost 견적 중복 방지 — source_market_price_id 부분 UNIQUE 인덱스
-- promote-supplier(일괄)·ingest-cost(단건) 두 경로의 동시 호출 race로 같은 시장가가
-- 중복 cost 견적으로 인입되는 것을 DB 레벨에서 차단(앱 레벨 가드 보강).
-- 활성(deleted_at NULL) cost 견적에 한해 source_market_price_id 유일성 보장.
-- 멱등: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_quotes_market_link
  ON supply_quotes (source_market_price_id)
  WHERE price_type = 'cost'
    AND deleted_at IS NULL
    AND source_market_price_id IS NOT NULL;
