-- 227: 매출 인식 장부 — 수주 매출 · 재원 4갈래 · 현물 명세 · 민감도 · 능력
--
-- **왜**: 딜의 금액 칸이 하나(`amountMinor`)뿐인데 그게 무엇인지 적힌 곳이 0곳이었다.
--   VAT 포함인지 별도인지, 현물이 들어 있는지, 사업비 전체인지 — 스키마 주석에도
--   화면 라벨에도 없다. 그 한 칸을 로직 9곳과 화면 11개가 각자 해석하고 있었다.
--
-- **무엇이 바뀌나**: 숫자 셋이 각자 자리를 갖는다.
--   · 수주 매출  = 전체 사업비 (계약 > 견적 > 예산 중 가장 확실한 것)
--   · 현물 제외  = 수주 매출 − 현물   ← **저장하지 않는다.** 파생이다
--   · 회계 수익  = 국비 + 지방비      ← 재원에서 계산한다
--
-- **현물이 왜 딜에 붙나**: 고객에게 «인력 3명을 현물로 2억 넣습니다»라고 적을 일이 없다.
--   그건 협약서·정산 서류의 언어이고 우리가 매출을 얼마로 인식하느냐의 문제다.
--   그래서 견적서(crm_quote)가 아니라 **딜의 장부**에 산다.
--
-- **전부 추가 전용이다.** DROP 이 하나도 없다.
--   기존 `crm_deal.amountMinor` 는 이관 중이라 남겨 두고(expand),
--   소비 코드를 전부 옮긴 뒤 별도 마이그레이션에서 지운다(contract).
--
-- 관계 계약(R-1): crm_funding_source · crm_in_kind · crm_deal_amount_history 는
--   전부 **소유(owns)** — 딜이 없으면 존재 이유가 없다 → ON DELETE CASCADE.
--   딜 삭제 확인창에 «현물 N건도 함께 삭제됩니다»가 떠야 한다(R-5).

BEGIN;


-- CreateEnum
CREATE TYPE "CrmTaxBasis" AS ENUM ('NET', 'GROSS');

-- CreateEnum
CREATE TYPE "CrmTaxKind" AS ENUM ('TAXABLE', 'ZERO_RATED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "CrmTermType" AS ENUM ('SHORT', 'MID', 'LONG');

-- CreateEnum
CREATE TYPE "CrmBusinessType" AS ENUM ('GPU', 'SI', 'SOLUTION', 'HARDWARE', 'MSP', 'PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmFundingSourceType" AS ENUM ('NATIONAL', 'LOCAL', 'OWN_CASH', 'IN_KIND');

-- CreateEnum
CREATE TYPE "CrmInKindKind" AS ENUM ('LABOR', 'EQUIPMENT', 'MATERIAL', 'FACILITY');

-- CreateEnum
CREATE TYPE "CrmAttachmentTarget" AS ENUM ('DEAL', 'COMPANY', 'PERSON', 'MEETING', 'QUOTE', 'DEAL_COST', 'IN_KIND');

-- CreateEnum
CREATE TYPE "CrmAttachmentKind" AS ENUM ('BUSINESS_CARD', 'SUPPLY_QUOTE', 'CONTRACT', 'IN_KIND_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmSensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED');

-- AlterTable
ALTER TABLE "crm_member" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "crm_stage" ADD COLUMN     "winProbabilityPct" INTEGER;

-- AlterTable
ALTER TABLE "crm_deal" ADD COLUMN     "bookedNetMinor" BIGINT,
ADD COLUMN     "budgetNetMinor" BIGINT,
ADD COLUMN     "businessType" "CrmBusinessType",
ADD COLUMN     "contractNetMinor" BIGINT,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "inKindTotalMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "primaryQuoteId" TEXT,
ADD COLUMN     "quotedNetMinor" BIGINT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "taxBasis" "CrmTaxBasis" NOT NULL DEFAULT 'NET',
ADD COLUMN     "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 10,
ADD COLUMN     "termMonths" INTEGER,
ADD COLUMN     "termType" "CrmTermType";

-- CreateTable
CREATE TABLE "crm_funding_source" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "sourceType" "CrmFundingSourceType" NOT NULL,
    "amountMinor" BIGINT NOT NULL DEFAULT 0,
    "agencyName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_funding_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_in_kind" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "CrmInKindKind" NOT NULL,
    "name" TEXT NOT NULL,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "basisNote" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_in_kind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_amount_history" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromMinor" BIGINT,
    "toMinor" BIGINT,
    "reason" TEXT,
    "sourceQuoteId" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_amount_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "da_company_profile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ceoName" TEXT,
    "bizRegNo" TEXT,
    "address" TEXT,
    "tel" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "sealMode" TEXT NOT NULL DEFAULT 'OMIT',
    "quotePrefix" TEXT NOT NULL DEFAULT 'DA',
    "logoUrl" TEXT,
    "defaultPaymentTerms" TEXT,
    "defaultValidDays" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "da_company_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_attachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" "CrmAttachmentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "kind" "CrmAttachmentKind" NOT NULL DEFAULT 'OTHER',
    "sensitivity" "CrmSensitivity" NOT NULL DEFAULT 'INTERNAL',
    "ocrStatus" TEXT,
    "ocrResultJson" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_funding_source_workspaceId_dealId_idx" ON "crm_funding_source"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "crm_in_kind_workspaceId_dealId_position_idx" ON "crm_in_kind"("workspaceId", "dealId", "position");

-- CreateIndex
CREATE INDEX "crm_deal_amount_history_workspaceId_dealId_changedAt_idx" ON "crm_deal_amount_history"("workspaceId", "dealId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "da_company_profile_workspaceId_key" ON "da_company_profile"("workspaceId");

-- CreateIndex
CREATE INDEX "crm_attachment_workspaceId_targetType_targetId_idx" ON "crm_attachment"("workspaceId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "crm_funding_source" ADD CONSTRAINT "crm_funding_source_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_in_kind" ADD CONSTRAINT "crm_in_kind_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_amount_history" ADD CONSTRAINT "crm_deal_amount_history_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 백필 ────────────────────────────────────────────────────────────
-- 기존 딜은 테스트 데이터 2건뿐이다(사용자 확인: "기존 데이터는 고려하지 마").
-- 그래도 `amountMinor` 를 통째로 버리지 않고 **수주 매출로 간주해** 옮긴다 —
-- 이관 중인 칸을 비워 두면 화면이 «금액 미정»으로 보이고, 그건 사실이 아니다.
UPDATE "crm_deal"
   SET "contractNetMinor" = "amountMinor",
       "bookedNetMinor"   = "amountMinor"
 WHERE "amountMinor" IS NOT NULL
   AND "status" = 'WON'
   AND "bookedNetMinor" IS NULL;

UPDATE "crm_deal"
   SET "budgetNetMinor" = "amountMinor",
       "bookedNetMinor" = "amountMinor"
 WHERE "amountMinor" IS NOT NULL
   AND "status" <> 'WON'
   AND "bookedNetMinor" IS NULL;

-- 기간이 있으면 개월 수는 계산이다 — 손으로 넣지 않는다
UPDATE "crm_deal"
   SET "termMonths" = GREATEST(1,
         (EXTRACT(YEAR FROM "endDate") - EXTRACT(YEAR FROM "startDate")) * 12
       + (EXTRACT(MONTH FROM "endDate") - EXTRACT(MONTH FROM "startDate")) + 1)::int
 WHERE "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "termMonths" IS NULL;

-- 단계 확률 — 없으면 가중 파이프라인을 못 만든다.
-- 업계 기본값(L0)으로 시작하고 딜 30건이 쌓이면 우리 실적으로 대체한다(예측 L1).
UPDATE "crm_stage" SET "winProbabilityPct" = 100 WHERE "kind" = 'WON'  AND "winProbabilityPct" IS NULL;
UPDATE "crm_stage" SET "winProbabilityPct" = 0   WHERE "kind" = 'LOST' AND "winProbabilityPct" IS NULL;

-- 열린 단계는 위치에 비례해 올린다(첫 단계 10% → 마지막 열린 단계 80%).
-- 관례값을 박아 넣는 것이 아니라 **자리에서 계산**한다 — 파이프라인마다 단계 수가 다르다.
WITH open_stages AS (
  SELECT "id", "pipelineId",
         ROW_NUMBER() OVER (PARTITION BY "pipelineId" ORDER BY "position") AS rn,
         COUNT(*)    OVER (PARTITION BY "pipelineId")                      AS total
    FROM "crm_stage" WHERE "kind" = 'OPEN'
)
UPDATE "crm_stage" s
   SET "winProbabilityPct" = CASE WHEN o.total <= 1 THEN 50
        ELSE (10 + ROUND((o.rn - 1) * 70.0 / (o.total - 1)))::int END
  FROM open_stages o
 WHERE s."id" = o."id" AND s."winProbabilityPct" IS NULL;

-- 관리자에게 원가 능력을 준다(답 6 — 지금은 관리자만, 나중에 표 한 줄로 푼다)
UPDATE "crm_member"
   SET "capabilities" = ARRAY['cost.view','cost.edit','margin.view','quote.send','quote.approve']
 WHERE "role" IN ('OWNER','ADMIN')
   AND ("capabilities" IS NULL OR cardinality("capabilities") = 0);

-- ── RLS ─────────────────────────────────────────────────────────────
-- CRM 은 PostgREST 를 쓰지 않고 전부 서버사이드 Prisma 다(207 §RLS 와 같은 이유).
-- 정책을 거는 것과 별개로 anon·authenticated 권한 자체를 회수한다.

ALTER TABLE "crm_funding_source"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_in_kind"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_deal_amount_history"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_attachment"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "da_company_profile"       ENABLE ROW LEVEL SECURITY;

ALTER TABLE "crm_funding_source"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_in_kind"              FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_deal_amount_history"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_attachment"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "da_company_profile"       FORCE ROW LEVEL SECURITY;

CREATE POLICY "crm_funding_source_tenant" ON "crm_funding_source" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_in_kind_tenant" ON "crm_in_kind" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_deal_amount_history_tenant" ON "crm_deal_amount_history" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_attachment_tenant" ON "crm_attachment" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "da_company_profile_tenant" ON "da_company_profile" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

REVOKE ALL ON TABLE "crm_funding_source"      FROM anon, authenticated;
REVOKE ALL ON TABLE "crm_in_kind"             FROM anon, authenticated;
REVOKE ALL ON TABLE "crm_deal_amount_history" FROM anon, authenticated;
REVOKE ALL ON TABLE "crm_attachment"          FROM anon, authenticated;
REVOKE ALL ON TABLE "da_company_profile"      FROM anon, authenticated;

COMMIT;
