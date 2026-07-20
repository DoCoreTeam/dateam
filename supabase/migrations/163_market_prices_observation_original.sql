-- 163_market_prices_observation_original.sql
-- 목적: 경쟁사 시세 1건을 "관측된 그대로(원본)" 무손실 저장 — 환산값은 파생(재계산 가능).
--   배경: 134가 original_price/original_currency를 추가했으나, 그 값도 이미 "GPU 1장·1시간당"으로
--   환산된 파생값이라 진짜 원본(예: ¥2,500,000/월·8장·번들·税別)의 기간·수량·포함범위·세금기준이 소실됨.
--   → 관측 사실(불변) 축을 추가 저장하고, 표시/집계는 결정론 코드(normalize-money SSOT)가 파생.
-- 확정 기획: docs/2026-07-20-v0.7.336-multi-currency-original-store/02-CONFIRMED.md (P1)
-- additive only — 기존 행/컬럼 무변경, 전부 NULL 허용(기존 행은 파생값 경로 그대로).
-- 금액은 NUMERIC(부동소수 오류 금지 — 업계 정석).

ALTER TABLE market_prices
  -- 관측 원본(불변)
  ADD COLUMN IF NOT EXISTS obs_amount        numeric,   -- 관측된 그대로의 금액(예 2500000). currency 기준.
  ADD COLUMN IF NOT EXISTS obs_currency      text,      -- ISO4217(JPY/KRW/USD/CNY…). 통화 확정 결과.
  ADD COLUMN IF NOT EXISTS obs_pricing_unit  text,      -- 기간 단위: minute|hour|day|month|year (FOCUS PricingUnit)
  ADD COLUMN IF NOT EXISTS obs_gpu_count     integer,   -- 이 금액이 포함하는 GPU 장수(번들 8장 등). NULL=불명.
  ADD COLUMN IF NOT EXISTS obs_tax_basis     text,      -- tax_excluded(税別)|tax_included(税込)|unknown
  ADD COLUMN IF NOT EXISTS obs_bundle_inclusive boolean,-- 스토리지·네트워크 등 포함 번들가 여부
  ADD COLUMN IF NOT EXISTS obs_inclusions    text,      -- 포함 항목 원문(예 "storage, InfiniBand, SW")
  ADD COLUMN IF NOT EXISTS obs_segment       text,      -- raw_gpu | managed_bundle (콕핏 밴드 격리 축)
  ADD COLUMN IF NOT EXISTS obs_comparable    boolean,   -- per-GPU·hr 비교 가능 여부(false=참고전용, 랭킹 제외)
  -- 환율 스냅샷(관측 시점 동결 — 이력·판가용. 표시는 최신환율 재환산)
  ADD COLUMN IF NOT EXISTS fx_rate           numeric,   -- 1 obs_currency = fx_rate KRW (1단위 정규화 후)
  ADD COLUMN IF NOT EXISTS fx_rate_date      date,      -- 적용 환율 고시일(휴일 폴백 시 실제 적용일)
  ADD COLUMN IF NOT EXISTS fx_source         text,      -- 'koreaexim' 등
  -- 품질 메타
  ADD COLUMN IF NOT EXISTS observed_at       timestamptz, -- 관측(수집)일 — 신선도(stale) 판정 축
  ADD COLUMN IF NOT EXISTS provenance        text,      -- 원문 근거 span(추출 grounding)
  ADD COLUMN IF NOT EXISTS confirmed_by_kind text;      -- 'auto' | 'human'

-- 값 도메인 가드(NULL 허용 — 기존 행 보호. NOT VALID로 신규/수정만 강제, 과거 무손상).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_prices_obs_pricing_unit_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT market_prices_obs_pricing_unit_chk
      CHECK (obs_pricing_unit IS NULL OR obs_pricing_unit IN ('minute','hour','day','month','year')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_prices_obs_segment_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT market_prices_obs_segment_chk
      CHECK (obs_segment IS NULL OR obs_segment IN ('raw_gpu','managed_bundle')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_prices_obs_tax_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT market_prices_obs_tax_chk
      CHECK (obs_tax_basis IS NULL OR obs_tax_basis IN ('tax_excluded','tax_included','unknown')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_prices_obs_amount_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT market_prices_obs_amount_chk
      CHECK (obs_amount IS NULL OR obs_amount > 0) NOT VALID;
  END IF;
END $$;

-- 신선도·세그먼트 필터가 콕핏 밴드 쿼리에 쓰이므로 인덱스(관측일·세그먼트).
CREATE INDEX IF NOT EXISTS idx_market_prices_observed_at ON market_prices (observed_at);
CREATE INDEX IF NOT EXISTS idx_market_prices_obs_segment ON market_prices (obs_segment);

COMMENT ON COLUMN market_prices.obs_amount IS '관측 원본 금액(obs_currency 기준, 환산 전). 진실값 — price_usd는 파생. 확정기획 P1.';
COMMENT ON COLUMN market_prices.obs_segment IS 'raw_gpu=순수 GPU 시간임대 / managed_bundle=매니지드·번들(콕핏 밴드 기본 제외, 참고전용).';
COMMENT ON COLUMN market_prices.fx_rate IS '관측 시점 환율 스냅샷(1 obs_currency=KRW). 이력·판가용 고정. 표시는 최신환율 재환산.';
