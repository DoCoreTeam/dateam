-- 325: 계약이 딜 없이 선다 (P0184 I01)
--
-- 계약은 딜에 딸린 부속이 아니라 그 자체로 서는 기록이다. 매입, 제휴, 컨소시엄,
-- 회사 단위 계약(투자 근로 임대)은 딜이 없다. 그래서 넷을 바꾼다.
--
-- 1 dealId 를 비워도 된다. 딜을 지우면 계약이 **같이 지워지던** FK(CASCADE)를
--   SET NULL 로 바꾼다. 체결한 계약이 딜 정리 한 번에 사라지는 것은 남겨서 잃는 것이 아니라
--   지워서 잃는 것이다 (관계 종류: 소유 → 참조)
-- 2 계약의 성격 넷: 방향, 양식 주인, 문서 층, 민감 등급
-- 3 당사자 N명 (crm_contract_party, 계약이 소유)
-- 4 연결 (crm_contract_link). 폴리모픽으로 두면 FK 를 못 걸어 고아가 생긴다 —
--   대상 종류마다 칼럼 하나에 FK 를 걸고 정확히 하나만 채우게 한다
--
-- 실측 2026-11-09: crm_contract 0건, 이관할 행 없음

-- ── 1 딜 없이 ──────────────────────────────────────────────────────────
ALTER TABLE "crm_contract" ALTER COLUMN "dealId" DROP NOT NULL;
ALTER TABLE "crm_contract" DROP CONSTRAINT "crm_contract_dealId_fkey";
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2 계약의 성격 ──────────────────────────────────────────────────────
-- 방향: 매출(우리가 공급) 매입(우리가 발주) 제휴(대등) 공동수급(컨소시엄) 3자(중개) 기타(회사 단위)
ALTER TABLE "crm_contract" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'SALES'
  CHECK ("direction" IN ('SALES', 'PURCHASE', 'PARTNERSHIP', 'CONSORTIUM', 'BROKERAGE', 'CORPORATE'));
-- 양식 주인: 우리 양식, 상대 양식, 발주처 고정 양식(공공 국책)
ALTER TABLE "crm_contract" ADD COLUMN "formOwner" TEXT NOT NULL DEFAULT 'OURS'
  CHECK ("formOwner" IN ('OURS', 'THEIRS', 'ISSUER'));
-- 문서 층: 단독, 기본계약, 개별계약(주문서), 변경계약, 업무협약, 비밀유지
ALTER TABLE "crm_contract" ADD COLUMN "docLayer" TEXT NOT NULL DEFAULT 'STANDALONE'
  CHECK ("docLayer" IN ('STANDALONE', 'MASTER', 'ORDER', 'AMENDMENT', 'MOU', 'NDA'));
-- 민감 등급: 영업, 매입, 회사 기밀(관리자만)
ALTER TABLE "crm_contract" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'SALES'
  CHECK ("sensitivity" IN ('SALES', 'PURCHASE', 'CORPORATE'));

CREATE INDEX "crm_contract_workspaceId_direction_idx" ON "crm_contract"("workspaceId", "direction");
CREATE INDEX "crm_contract_workspaceId_sensitivity_idx" ON "crm_contract"("workspaceId", "sensitivity");

-- ── 3 당사자 ───────────────────────────────────────────────────────────
-- isSelf: 우리 회사인가. 매입이면 우리가 갑, 매출이면 을이다 — 방향과 이 칸이 칸 채우기를 정한다
-- snapshot: 체결 때의 상호 대표자 사업자번호 주소. 회사 행이 바뀌어도 계약서 글자는 안 바뀐다
CREATE TABLE "crm_contract_party" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "role" TEXT NOT NULL
      CHECK ("role" IN ('SUPPLIER', 'CUSTOMER', 'LEAD', 'MEMBER', 'BROKER', 'PARTNER', 'OTHER')),
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_party_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_contract_party_contractId_position_idx" ON "crm_contract_party"("contractId", "position");
CREATE INDEX "crm_contract_party_workspaceId_companyId_idx" ON "crm_contract_party"("workspaceId", "companyId");
-- 계약을 지우면 당사자도 지운다 (소유). 회사를 지워도 당사자는 스냅샷으로 남는다 (참조)
ALTER TABLE "crm_contract_party" ADD CONSTRAINT "crm_contract_party_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "crm_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_party" ADD CONSTRAINT "crm_contract_party_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "crm_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contract_party" ADD CONSTRAINT "crm_contract_party_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4 연결 ─────────────────────────────────────────────────────────────
-- 연결은 계약과 대상 둘 다에 소유된다 — 어느 쪽이 지워져도 「연결」은 뜻이 없다
CREATE TABLE "crm_contract_link" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "dealId" TEXT,
    "quoteId" TEXT,
    "companyId" TEXT,
    "projectId" UUID,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_contract_link_one_target" CHECK (num_nonnulls("dealId", "quoteId", "companyId", "projectId") = 1)
);
CREATE INDEX "crm_contract_link_contractId_idx" ON "crm_contract_link"("contractId");
CREATE UNIQUE INDEX "crm_contract_link_contract_deal_key" ON "crm_contract_link"("contractId", "dealId") WHERE "dealId" IS NOT NULL;
CREATE UNIQUE INDEX "crm_contract_link_contract_quote_key" ON "crm_contract_link"("contractId", "quoteId") WHERE "quoteId" IS NOT NULL;
CREATE UNIQUE INDEX "crm_contract_link_contract_company_key" ON "crm_contract_link"("contractId", "companyId") WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "crm_contract_link_contract_project_key" ON "crm_contract_link"("contractId", "projectId") WHERE "projectId" IS NOT NULL;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "crm_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "crm_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "crm_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_link" ADD CONSTRAINT "crm_contract_link_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 (S1) ─────────────────
ALTER TABLE crm_contract_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contract_link  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_contract_party FROM anon, authenticated;
REVOKE ALL ON crm_contract_link  FROM anon, authenticated;
