-- ============================================================
-- 207_crm_quote.sql — 견적 (CrmProduct · CrmQuote · CrmQuoteLine)
--
-- 왜: 딜에 금액 칸은 있는데 그 금액이 어디서 나왔는지 적을 곳이 없었다.
--     영업은 "얼마"를 항목으로 쪼개 제시하고(무엇을 몇 개, 단가 얼마, 할인 얼마),
--     그 문서가 협상의 기준이 된다. 자리가 없으면 금액은 사람 머릿속에만 남는다.
--     (사용자 지적 2026-08-17: "견적 작성하는 기능은 존재하지도 않고")
--
-- 안전성: **순수 추가다.** 기존 테이블은 참조(FK 대상)로만 등장하고
--         DROP·ALTER COLUMN·UPDATE·DELETE 가 한 줄도 없다. 기존 데이터는 불변이다.
--
-- 생성 방법: 손으로 쓰지 않았다.
--   prisma migrate diff --from-schema-datamodel <HEAD 스키마> --to-schema-datamodel <현재> --script
--   그 출력에 아래 §2 RLS·권한 회수를 덧붙였다(199 와 같은 처리).
-- ============================================================

-- ------------------------------------------------------------
-- 1) 스키마 (prisma migrate diff 출력 그대로)
-- ------------------------------------------------------------

-- CreateEnum
CREATE TYPE "CrmQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "crm_product" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unitPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "unit" TEXT,
    "descriptionMd" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "quoteNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CrmQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notesMd" TEXT,
    "ownerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quote_line" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "lineTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_product_workspaceId_isActive_name_idx" ON "crm_product"("workspaceId", "isActive", "name");

-- CreateIndex
CREATE INDEX "crm_quote_workspaceId_dealId_createdAt_idx" ON "crm_quote"("workspaceId", "dealId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_quote_workspaceId_status_idx" ON "crm_quote"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_quote_workspaceId_quoteNo_key" ON "crm_quote"("workspaceId", "quoteNo");

-- CreateIndex
CREATE INDEX "crm_quote_line_quoteId_position_idx" ON "crm_quote_line"("quoteId", "position");

-- AddForeignKey
ALTER TABLE "crm_product" ADD CONSTRAINT "crm_product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quote" ADD CONSTRAINT "crm_quote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quote" ADD CONSTRAINT "crm_quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "crm_quote_line_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "crm_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "crm_quote_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "crm_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 2) 값 제약 — 금액은 조용히 틀리면 아무도 모른다
-- ------------------------------------------------------------

-- 수량·단가·합계는 음수가 될 수 없다. 할인율·세율은 0~100 이다.
ALTER TABLE "crm_quote_line"
  ADD CONSTRAINT "chk_quote_line_amounts"
  CHECK ("quantity" > 0
     AND "unitPriceMinor" >= 0
     AND "lineTotalMinor" >= 0
     AND "discountPercent" >= 0 AND "discountPercent" <= 100
     AND "taxRate" >= 0 AND "taxRate" <= 100);

ALTER TABLE "crm_quote"
  ADD CONSTRAINT "chk_quote_totals"
  CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0
     AND "taxMinor" >= 0 AND "totalMinor" >= 0);

ALTER TABLE "crm_product"
  ADD CONSTRAINT "chk_product_price"
  CHECK ("unitPriceMinor" >= 0 AND "taxRate" >= 0 AND "taxRate" <= 100);

-- 승인 없이 보낼 수 없다 — 상태 전이는 앱이 판정하지만, DB 도 마지막 선을 지킨다.
-- (초안은 얼마든지 써 볼 수 있어야 하므로 DRAFT 는 제약하지 않는다)
ALTER TABLE "crm_quote"
  ADD CONSTRAINT "chk_quote_approval"
  CHECK (status = 'DRAFT' OR "approvalRequired" = false OR "approvedAt" IS NOT NULL);

-- ------------------------------------------------------------
-- 3) RLS + 권한 회수 (199 와 같은 처리 — 새 테이블만 대상)
--
--    CRM 은 PostgREST 를 쓰지 않고 전부 서버사이드 Prisma 다.
--    Supabase 기본값이 public 스키마 신규 테이블에 anon·authenticated 전체 권한을 주므로,
--    정책을 거는 것과 별개로 **권한 자체를 회수**한다(199 §3 과 같은 이유).
-- ------------------------------------------------------------

ALTER TABLE "crm_product"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_quote"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_quote_line" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "crm_product"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_quote"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_quote_line" FORCE ROW LEVEL SECURITY;

-- workspaceId 를 직접 가진 둘은 직접 비교
CREATE POLICY "crm_product_tenant" ON "crm_product" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_quote_tenant" ON "crm_quote" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

-- 견적 항목은 부모(견적)를 통해 판정한다 — 자체 workspaceId 가 없다
CREATE POLICY "crm_quote_line_tenant" ON "crm_quote_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_quote" q
                  WHERE q."id" = "crm_quote_line"."quoteId"
                    AND q."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_quote" q
                  WHERE q."id" = "crm_quote_line"."quoteId"
                    AND q."workspaceId" = current_setting('app.workspace_id', true)));

REVOKE ALL ON TABLE "crm_product"    FROM anon, authenticated;
REVOKE ALL ON TABLE "crm_quote"      FROM anon, authenticated;
REVOKE ALL ON TABLE "crm_quote_line" FROM anon, authenticated;
