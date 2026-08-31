-- 236 · 개정본과 다른 안 — 「Rev.2」와 「1안/2안」
--
-- 왜: 보낸 견적은 **고칠 수 없다**(고치면 고객이 든 문서와 달라진다).
-- 그래서 지금은 값을 바꾸려면 견적을 새로 처음부터 써야 했고,
-- 새로 쓴 것과 보낸 것 사이에 **아무 연결도 없어서** 나중에 「이게 그 건의 몇 번째지?」를
-- 아무도 답할 수 없었다.
--
-- 두 가지는 뜻이 다르다:
--   · **개정(revision)** — 같은 제안의 다음 판. 앞 판을 대체한다. Rev.2, Rev.3…
--   · **다른 안(variant)** — 같은 시점의 선택지. 나란히 산다. 「1안 대용량 / 2안 표준」
-- 그래서 칸을 따로 둔다. 하나로 합치면 「2안의 Rev.3」을 표현할 수 없다.
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "sourceQuoteId" text,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "variantLabel" text;

COMMENT ON COLUMN crm_quote."sourceQuoteId" IS
  '어느 견적에서 복제됐나. 개정이든 다른 안이든 출처를 남긴다';
COMMENT ON COLUMN crm_quote.revision IS
  '개정 차수. 1 이면 첫 판(견적서에 표시하지 않는다)';
COMMENT ON COLUMN crm_quote."variantLabel" IS
  '다른 안의 이름 — 「1안」·「대용량 구성」. NULL 이면 안 구분 없음';

-- 출처 견적이 지워져도 이 견적은 남는다 — 문서는 스스로 완결이다
ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS crm_quote_source_fk;
ALTER TABLE crm_quote
  ADD CONSTRAINT crm_quote_source_fk
  FOREIGN KEY ("sourceQuoteId") REFERENCES crm_quote(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_source ON crm_quote("sourceQuoteId");

ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS chk_revision_positive;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_revision_positive CHECK (revision >= 1);
