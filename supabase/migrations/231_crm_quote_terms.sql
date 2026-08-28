-- 231: 거래 조건을 «항목»으로 — 사업 스타일마다 조건이 다르다
--
-- 지금은 설정에 **한 덩어리 텍스트**라 모든 견적서에 똑같이 나간다.
-- 그런데 GPU 사업 조건과 SI 사업 조건은 다르다
-- (사용자 지적: 「우리 사업 스타일별로 이 내용이 다 다르거든」).
--
-- 관리자는 조건을 **하나씩 등록**하고, 영업은 견적마다 **고른다**.
-- 기획 §08 「단위를 데이터로 — 새 것은 행 하나 추가, 코드 수정 없다」와 같은 방식이다.
--
-- 추가 전용(expand). 기존 설정(`quote.supplier.terms`)은 그대로 두고,
-- 등록된 항목이 하나도 없을 때의 폴백으로 계속 쓴다.

CREATE TABLE IF NOT EXISTS crm_quote_term (
  id            TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  -- 목록에서 고를 때 보이는 이름. 본문이 길어 그대로는 못 고른다
  title         TEXT NOT NULL,
  -- 견적서에 실제로 인쇄되는 문장
  body          TEXT NOT NULL,
  -- 이 사업 유형에서 주로 쓰는 조건. NULL 이면 모든 유형에서 보인다
  "businessType" "CrmBusinessType",
  -- 새 견적을 만들 때 기본으로 켜지는가
  "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  position      INT NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS crm_quote_term_ws_idx ON crm_quote_term("workspaceId", position);

-- 견적이 **어느 조건을 골랐나**.
-- 배열로 두는 이유: 조건은 서너 개고 순서가 뜻을 갖는다(인쇄 순서).
-- 연결 표로 만들면 순서를 또 저장해야 하고, 그 순서가 어긋난다.
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "termIds" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN crm_quote."termIds" IS
  '이 견적이 고른 거래 조건. 순서가 곧 인쇄 순서다';

ALTER TABLE crm_quote_term ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_quote_term FROM anon, authenticated;
