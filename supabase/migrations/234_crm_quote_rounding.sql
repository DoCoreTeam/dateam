-- 234 · 절사 지시 — 「끝자리를 떨어뜨려 주세요」를 견적이 기억한다
--
-- 왜: 협상 막바지에 「345,437,000원 말고 345,400,000원으로 해 주세요」가 반드시 나온다.
-- 지금은 그걸 적을 자리가 없어서 **단가를 손으로 조작**해 맞춰야 했다 —
-- 그러면 나중에 「왜 이 단가지?」를 아무도 설명할 수 없고, 원가 대비 마진도 거짓이 된다.
--
-- 그래서 단가는 그대로 두고 **절사액을 따로 남긴다.** 견적서에는 「절사 −37,000원」 한 줄이
-- 서고, 소계·할인·세액·총액이 서로 맞는 상태(불변식 I3·I5)가 유지된다.
--
-- 단위는 «원» 이다. 0 이면 절사 안 함. 방식은 셋뿐 — 버림이 기본이다(고객에게 유리한 쪽).
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "roundingUnit" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "roundingMode" text NOT NULL DEFAULT 'DOWN',
  ADD COLUMN IF NOT EXISTS "roundingMinor" bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN crm_quote."roundingUnit" IS
  '절사 단위(원). 0=안 함 · 1000=천원 · 10000=만원 · 100000=십만원 · 1000000=백만원';
COMMENT ON COLUMN crm_quote."roundingMode" IS
  'DOWN(버림·기본) · NEAREST(반올림) · UP(올림)';
COMMENT ON COLUMN crm_quote."roundingMinor" IS
  '절사로 깎인 금액. 서버가 계산해 저장한다 — 화면이 다시 계산하지 않는다';

ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS chk_rounding_unit;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_rounding_unit
  CHECK ("roundingUnit" IN (0, 1000, 10000, 100000, 1000000));

ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS chk_rounding_mode;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_rounding_mode
  CHECK ("roundingMode" IN ('DOWN', 'NEAREST', 'UP'));
