-- 견적서의 «공급받는 곳 담당자» — 누구 앞으로 보내는 견적인가
--
-- 왜 필요한가: 견적서를 받는 쪽에도 사람이 있다. 지금은 회사 이름만 「○○ 귀중」으로
-- 적고 끝나는데, 실제 문서는 «담당 교수님 귀하»처럼 사람을 지목한다.
-- 딜에 이미 사람이 여럿 붙어 있으므로(crm_deal_contact) 그중에서 고르게 한다.
--
-- 왜 NULL 을 허용하나: 고르지 않으면 안 나오는 것이 맞다(사용자 지시).
-- 회사 앞으로만 보내는 견적이 흔하고, 억지로 채우게 하면 아무나 골라 넣는다.
--
-- ON DELETE SET NULL — 인물을 지워도 견적은 남는다(관계 계약 R-1 «참조»).
-- 견적은 이미 발행된 문서라 사람이 나갔다고 사라지면 안 된다.
ALTER TABLE "crm_quote"
  ADD COLUMN IF NOT EXISTS "recipientPersonId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_quote_recipientPersonId_fkey'
  ) THEN
    ALTER TABLE "crm_quote"
      ADD CONSTRAINT "crm_quote_recipientPersonId_fkey"
      FOREIGN KEY ("recipientPersonId") REFERENCES "crm_person"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "crm_quote_recipientPersonId_idx"
  ON "crm_quote" ("recipientPersonId");
