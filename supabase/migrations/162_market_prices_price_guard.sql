-- 162_market_prices_price_guard.sql
-- 목적: 경쟁사 시장가(market_prices.price_usd)의 "불가능 범위" 값을 DB 레벨에서 최종 차단.
--   배경: 일본 사이트 URL 사고 — ¥30,000이 통화 미환산으로 $30,000(150배)으로 저장될 뻔함.
--   앱 게이트(lib/gpu/validate.ts PRICE_HARD: 0<p≤1000)를 미러하는 최후 방어선(app 게이트가 뚫려도 막음).
--   SSOT: validate.ts PRICE_HARD.max=1000, PRICE_HARD.min=0 과 동일 값 유지(드리프트 주의).
--
-- 안전: NOT VALID — 신규/수정 행에만 적용. 기존 행은 검증하지 않아 과거 데이터 파괴 없음(기존 데이터 보호 정책).
--   과거 이상치는 후속 정제 배치로 별도 처리(이 마이그는 추가 오염 유입만 차단).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_prices_price_usd_range'
      AND conrelid = 'market_prices'::regclass
  ) THEN
    ALTER TABLE market_prices
      ADD CONSTRAINT market_prices_price_usd_range
      CHECK (price_usd > 0 AND price_usd <= 1000)
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT market_prices_price_usd_range ON market_prices IS
  'price_usd 불가능 범위 차단(0<p≤1000). validate.ts PRICE_HARD 미러. 통화 미환산 둔갑값($30,000 등) DB 최종 방어. NOT VALID=기존행 보호.';
