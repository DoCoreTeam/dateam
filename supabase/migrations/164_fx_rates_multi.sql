-- 164_fx_rates_multi.sql
-- 목적: 환율을 USD/KRW 1쌍(fx_rates.usd_krw)만이 아니라 "통화별"로 저장 — 엔·위안·유로 등 다통화 환산 기반.
--   소스(한국수출입은행 AP01)는 이미 전 통화를 한 번에 반환하므로 파서만 확장하면 됨.
-- 확정 기획 P2: docs/2026-07-20-.../02-CONFIRMED.md
-- 핵심: JPY·IDR 등은 "100단위 고시"(cur_unit="JPY(100)") → per_unit 저장 + krw_per_unit_1(1단위 정규화값) 함께.
-- additive only — 기존 fx_rates(usd_krw) 무변경(호환 유지). 신규 테이블 병행.

CREATE TABLE IF NOT EXISTS fx_rates_multi (
  rate_date     date    NOT NULL,               -- 고시일(휴일 폴백 시 실제 적용일)
  currency      text    NOT NULL,               -- ISO4217 (USD/JPY/EUR/CNY …)
  per_unit      integer NOT NULL DEFAULT 1,     -- 고시 단위(JPY=100, 그 외 대개 1)
  deal_bas_krw  numeric NOT NULL,               -- 매매기준율(per_unit 통화당 KRW, 원문 그대로)
  krw_per_1     numeric NOT NULL,               -- 1통화당 KRW = deal_bas_krw / per_unit (정규화 — 100배 사고 방지)
  source        text    NOT NULL DEFAULT 'koreaexim',
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency)
);

COMMENT ON TABLE fx_rates_multi IS '통화별 매매기준율(한국수출입은행 AP01). krw_per_1=1통화당 KRW(JPY 100단위 정규화 완료). 환산 SSOT=lib/gpu/normalize-money.ts.';
COMMENT ON COLUMN fx_rates_multi.per_unit IS '고시 단위. JPY/IDR=100. krw_per_1 = deal_bas_krw / per_unit.';
COMMENT ON COLUMN fx_rates_multi.krw_per_1 IS '1통화당 원화(정규화값). 환산은 항상 이 값 사용(100배 오류 방지).';

CREATE INDEX IF NOT EXISTS idx_fx_rates_multi_currency ON fx_rates_multi (currency, rate_date DESC);

-- RLS: 읽기 공개(환산 표시), 쓰기 서비스롤만(024 fx_rates와 동일 정책).
ALTER TABLE fx_rates_multi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "all: read fx_rates_multi" ON fx_rates_multi;
CREATE POLICY "all: read fx_rates_multi" ON fx_rates_multi FOR SELECT USING (true);
DROP POLICY IF EXISTS "service: write fx_rates_multi" ON fx_rates_multi;
CREATE POLICY "service: write fx_rates_multi" ON fx_rates_multi FOR ALL USING (auth.role() = 'service_role');
