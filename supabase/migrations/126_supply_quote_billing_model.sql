-- =============================================================================
-- 126_supply_quote_billing_model.sql
-- 설치비(일회성) + 월 과금(반복) 분리 과금구조(v0.7.235): supply_quotes에 3개 컬럼 추가.
--   setup_fee_krw      = 일회성 설치비(KRW). 시간당 단가로 환산하지 않는 별도 비용.
--   monthly_price_krw  = 월 정기 단가(KRW) 원본 보존(있을 때). unit_price_usd(시간당)와 별개.
--   billing_model      = 과금 유형. 'hourly'(기존 기본) | 'monthly' | 'one_time_plus_monthly'
-- 비파괴: 전부 NULL 허용 / billing_model 기본 NULL(미지정=기존 hourly 동작과 동일 취급).
-- unit_price_usd(시간당 단일 단가) 계산식은 불변 — 설치비는 별도 컬럼으로 손실 없이 보존.
-- 사용자 요구: "설치비 따로 + 월 단가 따로"(스마일서브 RTX Pro 6000) 입력 시 설치비 소실 방지.
-- =============================================================================
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS setup_fee_krw numeric,
  ADD COLUMN IF NOT EXISTS monthly_price_krw numeric,
  ADD COLUMN IF NOT EXISTS billing_model text
    CHECK (billing_model IS NULL OR billing_model IN ('hourly', 'monthly', 'one_time_plus_monthly'));

COMMENT ON COLUMN supply_quotes.setup_fee_krw IS '일회성 설치비(KRW) — 시간당 환산 제외 별도 비용';
COMMENT ON COLUMN supply_quotes.monthly_price_krw IS '월 정기 단가(KRW) 원본 보존 — unit_price_usd와 별개';
COMMENT ON COLUMN supply_quotes.billing_model IS 'hourly|monthly|one_time_plus_monthly (NULL=hourly 취급)';

-- 음수 금액 방어(양수 또는 0 또는 NULL만)
ALTER TABLE supply_quotes
  DROP CONSTRAINT IF EXISTS supply_quotes_setup_fee_nonneg;
ALTER TABLE supply_quotes
  ADD CONSTRAINT supply_quotes_setup_fee_nonneg
  CHECK (setup_fee_krw IS NULL OR setup_fee_krw >= 0);
ALTER TABLE supply_quotes
  DROP CONSTRAINT IF EXISTS supply_quotes_monthly_price_nonneg;
ALTER TABLE supply_quotes
  ADD CONSTRAINT supply_quotes_monthly_price_nonneg
  CHECK (monthly_price_krw IS NULL OR monthly_price_krw >= 0);
