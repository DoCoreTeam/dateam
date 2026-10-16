-- 308: 계약서 — 견적서의 짝 (P0132 I03)
--
-- 견적은 우리가 보내는 문서고 계약은 양측이 날인하는 문서다.
-- 계약서는 「그날 무엇에 합의했나」를 증명해야 하므로 원칙을 하나로 세운다.
-- **버전은 한 번 쓰면 고치지 않는다. 고치면 다음 버전이다.**
--
-- 표 넷
--   crm_contract_template          템플릿 (작성 중 본문과 지금 쓰는 버전 번호)
--   crm_contract_template_version  발행한 템플릿 본문. 고치지 않는다
--   crm_contract                   계약서 한 건 (상태, 보냄, 체결, 가리키는 견적)
--   crm_contract_version           계약서 버전. 고치지 않는다
--
-- **기존 표는 건드리지 않는다.** 이 파일의 ALTER TABLE 은 전부 새 표가 대상이다.
-- 새 표가 crm_deal crm_quote crm_workspace 를 가리키는 FK 만 있고, 그 표들의 칼럼과 값은
-- 하나도 안 바뀐다 (사용자 지시 2026-10-16 「지금 데이터가 문제 생긴다거나 … 이건 안된다」).
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 예, 새 표 넷. 같은 마이그레이션에서 RLS 를 켜고
--      CRM 표 관례대로 anon authenticated 권한을 회수한다 (닿는 길은 서버 Prisma 연결뿐, 199 와 같다).
--      CREATE TABLE AS 사본이 아니다. TO public 정책이 없다.
--   ② 새 창구를 여나 — 이 파일은 아니다. 창구는 I06 I08 의 withCrmApi 라우트다.
--   ③ 밖에서 온 값을 다루나 — 본문 HTML 은 앱이 정리기를 거쳐 넣는다 (I05).
--
-- 되돌리기: DROP TABLE crm_contract_version, crm_contract, crm_contract_template_version,
--           crm_contract_template; DROP TYPE "CrmContractStatus"; DROP FUNCTION crm_contract_version_guard();
--           기존 표에는 남는 것이 없다.

-- CreateEnum
CREATE TYPE "CrmContractStatus" AS ENUM ('DRAFT', 'CONCLUDED', 'TERMINATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "crm_contract_template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessTypeKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "draftBody" JSONB,
    "currentVersionNo" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_contract_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contract_template_version" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "sourceFileName" TEXT,
    "sourceAttachmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contract" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "quoteId" TEXT,
    "contractNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CrmContractStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "parentContractId" TEXT,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3),
    "sentVersionNo" INTEGER,
    "concludedAt" TIMESTAMP(3),
    "concludedVersionNo" INTEGER,
    "signedAttachmentId" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "totalMinor" BIGINT,
    "currency" CHAR(3),
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contract_version" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "fieldValues" JSONB NOT NULL,
    "quoteSnapshot" JSONB,
    "supplierSnapshot" JSONB,
    "customerSnapshot" JSONB,
    "signatureSnapshot" JSONB,
    "templateVersionNo" INTEGER,
    "sourceQuoteId" TEXT,
    "sourceQuoteVersion" INTEGER,
    "contentHash" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contract_template_workspaceId_position_idx" ON "crm_contract_template"("workspaceId", "position");

-- CreateIndex
CREATE INDEX "crm_contract_template_version_workspaceId_idx" ON "crm_contract_template_version"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contract_template_version_templateId_versionNo_key" ON "crm_contract_template_version"("templateId", "versionNo");

-- CreateIndex
CREATE INDEX "crm_contract_workspaceId_dealId_createdAt_idx" ON "crm_contract"("workspaceId", "dealId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_contract_workspaceId_status_idx" ON "crm_contract"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contract_workspaceId_contractNo_key" ON "crm_contract"("workspaceId", "contractNo");

-- CreateIndex
CREATE INDEX "crm_contract_version_workspaceId_idx" ON "crm_contract_version"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contract_version_contractId_versionNo_key" ON "crm_contract_version"("contractId", "versionNo");

-- AddForeignKey
ALTER TABLE "crm_contract_template" ADD CONSTRAINT "crm_contract_template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract_template_version" ADD CONSTRAINT "crm_contract_template_version_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "crm_contract_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "crm_quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_parentContractId_fkey" FOREIGN KEY ("parentContractId") REFERENCES "crm_contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contract_version" ADD CONSTRAINT "crm_contract_version_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "crm_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 ─────────────────────────
ALTER TABLE crm_contract_template          ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contract_template_version  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contract                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contract_version           ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_contract_template          FROM anon, authenticated;
REVOKE ALL ON crm_contract_template_version  FROM anon, authenticated;
REVOKE ALL ON crm_contract                   FROM anon, authenticated;
REVOKE ALL ON crm_contract_version           FROM anon, authenticated;

-- ── 버전은 고치지 않는다 ─────────────────────────────────────────────────
/*
  서버 연결은 RLS 를 지나간다(rolbypassrls, client.ts 머리말). 그래서 「고치지 않는다」를
  정책이 아니라 **트리거**로 건다 — 어느 연결로 들어와도 UPDATE 는 거절된다.

  DELETE 는 하나만 받는다: **부모가 이미 지워진 때.** 계약서나 템플릿을 영구 삭제하면
  FK CASCADE 가 버전을 지우는데, 그때는 부모 행이 이미 없다. 버전만 따로 지우는 길은 없다.
*/
CREATE OR REPLACE FUNCTION crm_contract_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '계약서 버전은 고치지 않습니다. 고치려면 다음 버전을 만드세요 (%)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'crm_contract_version' THEN
    IF EXISTS (SELECT 1 FROM crm_contract WHERE id = OLD."contractId") THEN
      RAISE EXCEPTION '계약서 버전만 따로 지울 수 없습니다' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM crm_contract_template WHERE id = OLD."templateId") THEN
      RAISE EXCEPTION '템플릿 버전만 따로 지울 수 없습니다' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS crm_contract_version_lock ON crm_contract_version;
CREATE TRIGGER crm_contract_version_lock
  BEFORE UPDATE OR DELETE ON crm_contract_version
  FOR EACH ROW EXECUTE FUNCTION crm_contract_version_guard();

DROP TRIGGER IF EXISTS crm_contract_template_version_lock ON crm_contract_template_version;
CREATE TRIGGER crm_contract_template_version_lock
  BEFORE UPDATE OR DELETE ON crm_contract_template_version
  FOR EACH ROW EXECUTE FUNCTION crm_contract_version_guard();

REVOKE ALL ON FUNCTION crm_contract_version_guard() FROM anon, authenticated, public;
