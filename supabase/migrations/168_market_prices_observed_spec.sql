-- 168_market_prices_observed_spec.sql
-- 목적: 관측에서 인식한 **스펙 축**(폼팩터·메모리)을 보존한다.
--
-- 배경(실측 v0.7.365): AI가 verda "1x GB300 SXM6 288GB"에서 form_factor=SXM·memory_gb=288을
--   정확히 인식하는데, market_prices에 담을 컬럼이 없어 **매칭에만 쓰고 버려졌다**.
--   그래서 (a) 카탈로그에 없는 신규 모델(GB300)은 held로 보류되기만 하고 등록에 쓸 재료가 남지 않고,
--   (b) "RTX Pro 6000"처럼 96GB/48GB 변형이 여럿인 모델은 메모리를 알면서도 ambiguous_variant로 보류됐다.
--   → 관측 시점의 스펙을 그대로 남겨, 신규 모델 등록 제안과 변형 판별의 근거로 쓴다.
-- additive only — 기존 컬럼·행 무변경. NULL 허용(과거 행은 미상).

ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS obs_form_factor text;
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS obs_memory_gb   integer;
-- 원문 모델 라벨(캐노니컬 이전) — 신규 모델 등록 시 사람이 원문을 보고 판단할 근거.
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS obs_source_model text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mp_obs_form_factor_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT mp_obs_form_factor_chk
      CHECK (obs_form_factor IS NULL OR obs_form_factor IN ('SXM','PCIe','NVL')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mp_obs_memory_gb_chk' AND conrelid='market_prices'::regclass) THEN
    ALTER TABLE market_prices ADD CONSTRAINT mp_obs_memory_gb_chk
      CHECK (obs_memory_gb IS NULL OR obs_memory_gb > 0) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN market_prices.obs_form_factor IS '관측 시점 폼팩터(SXM|PCIe|NVL). 세대숫자(SXM4/5/6)는 계열로 흡수. SSOT=lib/gpu/form-factor.ts';
COMMENT ON COLUMN market_prices.obs_memory_gb IS '관측 시점 GPU 메모리(GB). 변형 판별·신규모델 등록 근거.';
COMMENT ON COLUMN market_prices.obs_source_model IS '원문 모델 라벨(캐노니컬 이전). 신규모델 등록 시 사람 판단 근거.';
