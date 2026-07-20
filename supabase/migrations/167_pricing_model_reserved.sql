-- 167_pricing_model_reserved.sql
-- 목적: competitor_product_mapping.pricing_model CHECK에 'reserved'(기간 미상 약정) 추가.
--
-- 배경(실사고 v0.7.362): 코드 SSOT `pricingModelForUnit`(lib/gpu/normalize-money.ts)은 월/년 단위 요금을
--   'reserved'로 분류하는데, DB CHECK는 'reserved_1y'·'reserved_3y'만 허용했다. 어휘가 어긋나 있었다.
--   결과: 월정액 번들(소프트뱅크 GB200·H100·A100 등)을 저장하려 하면 매핑 insert가 CHECK 위반으로 실패하고
--   saveCompetitorPrices가 continue로 넘어가 **saved에도 held에도 잡히지 않고 조용히 소멸**했다.
--   실측: SoftBank 저장 행이 on_demand 2건뿐 — 월정액은 단 한 건도 저장된 적이 없었다.
--
-- 왜 코드가 아니라 DB를 고치는가: '약정이되 기간 미상'은 실제로 존재하는 상태다(요금표에 "월액"만 있고
--   1년/3년 구분이 없는 경우). 이를 reserved_1y로 단정하면 없는 정보를 지어내는 것이고,
--   on_demand로 두면 시간제와 섞여 like-for-like 비교가 깨진다. 별도 값이 정확하다.
-- additive only — 기존 행·값 무손상.

ALTER TABLE competitor_product_mapping
  DROP CONSTRAINT IF EXISTS competitor_product_mapping_pricing_model_check;

ALTER TABLE competitor_product_mapping
  ADD CONSTRAINT competitor_product_mapping_pricing_model_check
  CHECK (pricing_model = ANY (ARRAY[
    'on_demand'::text,
    'spot'::text,
    'reserved'::text,      -- 약정(기간 미상) — 월정액 번들 표기
    'reserved_1y'::text,
    'reserved_3y'::text,
    'committed'::text
  ]));

COMMENT ON COLUMN competitor_product_mapping.pricing_model IS
  'like-for-like 비교축. on_demand(시간제) | spot(중단형) | reserved(약정·기간미상) | reserved_1y/3y(약정·기간명시) | committed. SSOT=lib/gpu/normalize-money.ts pricingModelForUnit.';
