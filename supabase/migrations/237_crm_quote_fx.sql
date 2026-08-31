-- 237 · 외화 견적의 원화 환산 — **환율을 문서에 박는다**
--
-- 왜: 견적 통화가 USD 면 고객도 우리도 「그래서 원화로 얼마인가」를 알아야 한다.
-- 그런데 환율은 **매일 바뀐다** — 조회할 때마다 환산하면 어제 보낸 견적서를 오늘 열었을 때
-- 다른 금액이 나온다. 고객이 든 종이와 우리 화면이 서로를 반박하는 상태다.
--
-- 그래서 **견적을 만든 날의 환율을 그 견적에 저장**한다. 문서는 스스로 완결이어야 한다.
-- 원본은 `fx_rates_multi`(한국수출입은행 매매기준율)이고, 여기 있는 것은 그날의 **사본**이다.
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "fxRate" numeric,
  ADD COLUMN IF NOT EXISTS "fxDate" date,
  ADD COLUMN IF NOT EXISTS "fxSource" text;

COMMENT ON COLUMN crm_quote."fxRate" IS
  '1 통화당 원. KRW 견적이면 NULL — 환산할 것이 없다';
COMMENT ON COLUMN crm_quote."fxDate" IS
  '그 환율의 고시일. 견적서에 함께 인쇄한다 — 언제 기준인지 모르면 숫자를 믿을 수 없다';
COMMENT ON COLUMN crm_quote."fxSource" IS
  '어디서 온 환율인가(koreaexim 등). 근거를 남긴다';

ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS chk_fx_rate_positive;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_fx_rate_positive
  CHECK ("fxRate" IS NULL OR "fxRate" > 0);
