-- 233 · 특별 할인 — 「기본 30% 인데 이번 건은 80%」를 적을 자리
--
-- 왜 칸을 하나 더 만드나: 지금은 할인율이 하나뿐이라 특별가를 넣으면
-- **기본 할인이 얼마였는지가 사라진다.** 그러면 견적서에서 「원래 얼마였는데
-- 이만큼 깎아 드립니다」를 말할 수 없고, 나중에 왜 이 가격이었는지도 알 수 없다.
-- (사용자 지시: 「단가가 1억인데 기본 할인이 30% 들어가는데 너네는 80%할인해주겠다 이런게 없어」)
--
-- 뜻: NULL 이면 특별 할인 없음(기본 할인만 적용). 값이 있으면 **그 값이 적용 할인율**이고
-- 기본 할인율은 근거로만 남는다. 곱하지 않는다 — 80 을 넣었는데 86% 가 되면
-- 사용자가 넣은 숫자가 화면에 없다.
ALTER TABLE crm_quote_line
  ADD COLUMN IF NOT EXISTS "specialDiscountPercent" numeric(5,2),
  ADD COLUMN IF NOT EXISTS "specialDiscountReason" text;

COMMENT ON COLUMN crm_quote_line."specialDiscountPercent" IS
  '특별 할인율(%). NULL 이면 없음. 값이 있으면 discountPercent 대신 이 값이 적용된다';
COMMENT ON COLUMN crm_quote_line."specialDiscountReason" IS
  '특별 할인을 준 이유 — 승인·감사에서 이것이 근거가 된다';

-- 범위를 DB 가 지킨다. 화면만 막으면 API 로 들어오는 값을 못 막는다
ALTER TABLE crm_quote_line
  DROP CONSTRAINT IF EXISTS chk_special_discount_range;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT chk_special_discount_range
  CHECK ("specialDiscountPercent" IS NULL
         OR ("specialDiscountPercent" >= 0 AND "specialDiscountPercent" <= 100));
