-- 312: 견적에 쓴 글을 남긴다 (P0136 I04)
--
-- 말로 채우기가 늘 열린 편집기가 된다. 쓴 글은 견적과 함께 저장되고, 다시 열면 그대로 있다.
-- 전에는 글이 남지 않아(QuoteFillPanel 의 글 상자) 왜 이 숫자가 나왔는지 다음 사람이 몰랐다.
-- 줄과 글의 짝(textKey)은 crm_quote_line.provenance 안에 실으므로 칼럼이 더 필요 없다.
-- 지난 견적은 NULL 로 둔다(백필 없음). 지난 견적의 숫자는 하나도 안 바뀐다.
--
-- 보안 (LOOP.md 7절): ① 있는 표에 칼럼 하나, crm_quote 는 RLS 가 이미 켜져 있고 그대로 ② 창구 없음
--   ③ 사람이 쓴 글이라 길이 상한을 CHECK 로 건다(앱의 MAX_TEXT_LENGTH 8000 과 같은 값)
-- 되돌리기: ALTER TABLE "crm_quote" DROP COLUMN "fillText";

ALTER TABLE "crm_quote" ADD COLUMN IF NOT EXISTS "fillText" TEXT;
ALTER TABLE "crm_quote" DROP CONSTRAINT IF EXISTS "chk_quote_fill_text_len";
ALTER TABLE "crm_quote" ADD CONSTRAINT "chk_quote_fill_text_len" CHECK ("fillText" IS NULL OR char_length("fillText") <= 8000);
