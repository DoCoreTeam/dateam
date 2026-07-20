-- 165_market_price_components.sql
-- 목적: 관측 1건 = 요금성분 N개 (1:N). 복합/다부 요금제(기본료+종량+스토리지)를 무손실 저장.
--   배경(v0.7.351 재설계): market_prices.obs_amount는 스칼라 1개라 소프트뱅크 A100 시간제
--   (월額基本料金 30,000/월 + GPU利用料금 7.2円/1分 + 스토리지 1,000円/100GB) 3성분 중 1개만 저장·나머지 폐기.
--   기본료(계정 단위, GPU 무관)는 gpu_product FK가 없어 귀속 불가 → validate가 "非GPU→reject"로 폐기.
--   → 관측 헤더(market_prices)에 성분을 매다는 append-only 테이블 신설. 금액 진실은 이 테이블.
-- 확정 기획: docs/2026-07-20-v0.7.351-gpu-market-lossless-redesign/01-architecture.md §3
-- additive only — market_prices 무변경. 기존 obs_* 하위호환(성분 없으면 기존 경로 그대로).
-- 금액은 NUMERIC(부동소수 금지).

CREATE TABLE IF NOT EXISTS market_price_components (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  observation_id uuid        NOT NULL REFERENCES market_prices(id) ON DELETE CASCADE,
  -- 성분 성격: base_fee(계정 고정비·GPU무관) | usage(GPU·시간 종량) | storage(용량) | flat(월정액 번들 총액)
  component_kind text        NOT NULL,
  amount         numeric     NOT NULL,               -- 원본 통화 금액(무손실, 환산 전)
  currency       text        NOT NULL,               -- ISO4217
  -- 단위: 기간(시간계열) + per_gb(용량) + per_account(계정 고정) — obs_pricing_unit보다 확장
  unit           text        NOT NULL,
  gpu_count      integer,                            -- 해당 성분의 GPU 장수(base_fee/storage는 NULL 가능)
  -- 환율 스냅샷(관측 시점 동결 — 이력·판가용. 표시는 최신 재환산)
  fx_rate        numeric,                            -- 1 currency = fx_rate KRW (1단위 정규화)
  fx_rate_date   date,
  fx_source      text,
  tax_basis      text,                               -- tax_excluded | tax_included | unknown
  provenance     text,                               -- 원문 근거 span
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 값 도메인 가드(NOT VALID — 신규만 강제, 과거 무손상).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mpc_kind_chk' AND conrelid='market_price_components'::regclass) THEN
    ALTER TABLE market_price_components ADD CONSTRAINT mpc_kind_chk
      CHECK (component_kind IN ('base_fee','usage','storage','flat')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mpc_unit_chk' AND conrelid='market_price_components'::regclass) THEN
    ALTER TABLE market_price_components ADD CONSTRAINT mpc_unit_chk
      CHECK (unit IN ('minute','hour','day','week','month','year','per_gb','per_account')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mpc_amount_chk' AND conrelid='market_price_components'::regclass) THEN
    ALTER TABLE market_price_components ADD CONSTRAINT mpc_amount_chk
      CHECK (amount > 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpc_observation ON market_price_components (observation_id);
CREATE INDEX IF NOT EXISTS idx_mpc_kind ON market_price_components (component_kind);

COMMENT ON TABLE market_price_components IS '관측(market_prices) 1건의 요금성분 N개(1:N). 복합요금 무손실 저장. 금액 진실=이 테이블. SSOT=lib/gpu/price-components.ts.';
COMMENT ON COLUMN market_price_components.component_kind IS 'base_fee(계정 고정비)|usage(GPU 종량)|storage(용량)|flat(월정액 번들 총액).';
COMMENT ON COLUMN market_price_components.unit IS '기간(minute..year)+per_gb(용량)+per_account(계정). 시간환산 SSOT=lib/gpu/hours.ts.';

-- RLS: 읽기 = 인증 사용자(콕핏 표시), 쓰기 = 서비스롤만(market_prices와 동일 서버 경로).
ALTER TABLE market_price_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth: read mpc" ON market_price_components;
CREATE POLICY "auth: read mpc" ON market_price_components FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "service: write mpc" ON market_price_components;
CREATE POLICY "service: write mpc" ON market_price_components FOR ALL USING (auth.role() = 'service_role');
