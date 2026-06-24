-- 134_market_prices_original_currency.sql
-- 경쟁사 시장가 통화 원본보존(W1-W5) — 입력 통화/금액 무손실 보존 컬럼.
-- 왜: 통합입력 경쟁사 경로가 입력 통화(원/달러)를 강제 USD 변환만 저장 → 원본 통화·금액이 소실됐다.
--   price_usd(콕핏 비교용 USD 정규화)는 유지하고, 그 옆에 "사용자가 실제로 본 통화·금액"을 함께 보존한다.
--   표시는 fx_rates 실환율로 양통화 병기. 환산/통화감지는 lib/gpu/normalize-money.ts SSOT.
-- additive only — 기존 행/데이터 변경 없음(ADD COLUMN, NULL 허용, 롤백 가능).
--   기존 행은 original_currency NULL → 표시 시 'USD 가정' 폴백(price_usd 그대로).

ALTER TABLE market_prices
  ADD COLUMN IF NOT EXISTS original_currency text,
  ADD COLUMN IF NOT EXISTS original_price numeric;

COMMENT ON COLUMN market_prices.original_currency IS 'ISO 통화코드(KRW/USD 등) — 사용자가 입력한 원본 통화. NULL이면 기존 행(USD 가정). 환산/감지 SSOT=lib/gpu/normalize-money.ts.';
COMMENT ON COLUMN market_prices.original_price IS 'original_currency 기준 원본 금액(GPU 1장·1시간당). price_usd는 fx_rates 실환율로 산출된 USD 정규화값.';
