-- 310: 가격 기준 — 제품, 규칙, 가격 이력 (P0135 I07)
--
-- 견적 항목은 어느 기준에서 단가가 왔는지 몰랐다. 기준은 흩어져 있었다.
-- 품목 정상가 5개가 전부 0원, 인건비 등급 0줄, GPU 판매가가 견적으로 오는 길 0곳(실측 2026-10-20).
-- 그래서 엔진이 빈칸을 대신 채울 수 없었고 사람이 매번 다시 쳤다.
--
-- 새 표 셋
--   crm_price_product  제품. 품목을 모은 단위(gcube edge). 묶음 절사, 몇 년 총비용, 계산 예시
--   crm_price_rule     규칙 일곱 종류. 할인도 규칙의 한 종류다
--   crm_price_history  정상가와 등급 단가의 흐름. 고칠 때마다 새 줄이고 고치거나 지우지 않는다
--
-- 있는 표에 칼럼
--   crm_product        제품, 묶음, 가격 기준, 청구, 비율, 할인 대상, 다른 이름, 규격, 확인 전, 자동 등록
--   crm_labor_grade    공표 노임단가, 적용 시작일, 버전
--   crm_quote_line     그날 정상가, 가격 기준, 출처, 청구, 앞 견적의 항목, 사람이 잠근 칸
--   crm_quote_section  묶음 절사, 사업 유형
--   crm_quote          예산, 기준 날짜, 자동으로 채운 값, 매년 금액, 묶음 절사 합, 조건
--   crm_business_type  마진율
--
-- **기존 행은 한 줄도 안 바뀐다.** 새 칼럼은 NULL 이거나 기본값이 지금 셈과 같다.
-- 출처가 빈 지난 견적은 지금 계산 그대로 간다(앱이 출처 있는 견적만 새 엔진에 태운다). 백필 없음.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 예, 새 표 셋. 같은 파일에서 RLS 를 켜고 anon authenticated 권한을 회수한다.
--      닿는 길은 서버 Prisma 연결뿐이다(199, 308 과 같다). CREATE TABLE AS 사본이 아니다. TO public 정책 없음.
--      원가(crm_labor_grade.costPerMmMinor)는 이미 있던 칼럼이고 공개 API 로 안 나간다.
--   ② 새 창구를 여나 — 이 파일은 아니다. 창구는 I09 의 withCrmApi 라우트이고 고치기는 ADMIN 이다.
--   ③ 밖에서 온 값을 다루나 — 예, 파일에서 읽은 가격. 그래서 DB 가 마지막 선을 지킨다(아래 CHECK).
--      가격 이력은 고치기 지우기를 트리거가 막는다 — 고칠 수 있는 이력은 이력이 아니다.
--
-- 되돌리기: DROP TABLE crm_price_history, crm_price_rule; ALTER TABLE crm_product DROP COLUMN "priceProductId";
--           DROP TABLE crm_price_product; DROP FUNCTION crm_price_history_guard();
--           그리고 아래 ADD COLUMN 칼럼들을 DROP COLUMN. 기존 값은 하나도 안 바뀌었으므로 잃는 것이 없다.

-- ── 제품 ────────────────────────────────────────────────────────────────
CREATE TABLE "crm_price_product" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessTypeKey" TEXT NOT NULL DEFAULT 'SOLUTION',
    "descriptionMd" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "tcoYears" INTEGER NOT NULL DEFAULT 5,
    "freeYears" INTEGER NOT NULL DEFAULT 1,
    "examples" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "sourceAttachmentId" TEXT,
    "sourceFileName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "crm_price_product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_price_product_years" CHECK ("tcoYears" BETWEEN 1 AND 20 AND "freeYears" BETWEEN 0 AND "tcoYears")
);
CREATE INDEX "crm_price_product_workspaceId_isActive_name_idx" ON "crm_price_product"("workspaceId", "isActive", "name");
-- 지우지 않은 제품끼리 이름이 겹치지 않는다
CREATE UNIQUE INDEX "crm_price_product_name_live_key" ON "crm_price_product"("workspaceId", lower("name")) WHERE "deletedAt" IS NULL;
ALTER TABLE "crm_price_product" ADD CONSTRAINT "crm_price_product_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 규칙 ────────────────────────────────────────────────────────────────
CREATE TABLE "crm_price_rule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "body" JSONB NOT NULL DEFAULT '{}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_price_rule_pkey" PRIMARY KEY ("id"),
    -- 규칙 종류는 일곱으로 닫는다. 무엇이든 적는 수식 칸은 검증할 수 없다
    CONSTRAINT "chk_price_rule_kind" CHECK ("kind" IN ('ONE_OF', 'WITH', 'INCLUDES', 'QTY_FROM', 'CAP', 'ELIGIBLE', 'DISCOUNT'))
);
CREATE INDEX "crm_price_rule_productId_position_idx" ON "crm_price_rule"("productId", "position");
ALTER TABLE "crm_price_rule" ADD CONSTRAINT "crm_price_rule_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "crm_price_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 가격 이력 ───────────────────────────────────────────────────────────
CREATE TABLE "crm_price_history" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    -- 무엇의 값인가 — 품목 정상가, 등급 판매 단가, 등급 원가, 공표 노임단가, 확인
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "amountMinor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_DATE,
    "sourceKind" TEXT NOT NULL DEFAULT 'HAND',
    "sourceName" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_price_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_price_history_target" CHECK ("targetType" IN ('ITEM', 'LABOR_GRADE')),
    CONSTRAINT "chk_price_history_field" CHECK ("field" IN ('listPrice', 'pricePerMm', 'costPerMm', 'publicRate', 'confirmed')),
    CONSTRAINT "chk_price_history_source" CHECK ("sourceKind" IN ('HAND', 'FILE', 'SEED', 'QUOTE')),
    CONSTRAINT "chk_price_history_amount" CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0)
);
CREATE INDEX "crm_price_history_target_idx" ON "crm_price_history"("workspaceId", "targetType", "targetId", "effectiveFrom" DESC, "createdAt" DESC);

/*
  가격 이력은 더해지기만 한다. 고치거나 지우는 길이 있으면 「작년 7,000,000원 → 올해 7,300,000원」이
  거짓이 될 수 있다. 시험이 운영 DB 를 지운 전례(공급자 정보 8줄)가 있어 지우기 길은 아예 두지 않는다.
  워크스페이스를 지울 때도 이 표는 RESTRICT 라 먼저 막힌다.
*/
CREATE OR REPLACE FUNCTION crm_price_history_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'crm_price_history 는 고치거나 지울 수 없습니다';
END;
$$;
REVOKE ALL ON FUNCTION crm_price_history_guard() FROM anon, authenticated, public;
CREATE TRIGGER "crm_price_history_no_change"
  BEFORE UPDATE OR DELETE ON "crm_price_history"
  FOR EACH ROW EXECUTE FUNCTION crm_price_history_guard();

-- ── 품목 ────────────────────────────────────────────────────────────────
ALTER TABLE "crm_product"
  ADD COLUMN IF NOT EXISTS "priceProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "section" TEXT,
  ADD COLUMN IF NOT EXISTS "basis" TEXT NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "billing" TEXT NOT NULL DEFAULT 'ONCE',
  ADD COLUMN IF NOT EXISTS "ratioPct" DECIMAL(7,4),
  ADD COLUMN IF NOT EXISTS "ratioOfSection" TEXT,
  ADD COLUMN IF NOT EXISTS "discountable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "spec" TEXT,
  ADD COLUMN IF NOT EXISTS "remark" TEXT,
  ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoRegistered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "crm_product" ADD CONSTRAINT "crm_product_priceProductId_fkey"
  FOREIGN KEY ("priceProductId") REFERENCES "crm_price_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "crm_product_priceProductId_position_idx" ON "crm_product"("priceProductId", "position");
ALTER TABLE "crm_product" ADD CONSTRAINT "chk_product_basis" CHECK ("basis" IN ('FIXED', 'PER_UNIT', 'RATIO', 'SURVEY'));
ALTER TABLE "crm_product" ADD CONSTRAINT "chk_product_billing" CHECK ("billing" IN ('ONCE', 'ANNUAL'));
ALTER TABLE "crm_product" ADD CONSTRAINT "chk_product_ratio" CHECK ("ratioPct" IS NULL OR ("ratioPct" >= 0 AND "ratioPct" <= 100));

-- ── 인건비 등급 ─────────────────────────────────────────────────────────
ALTER TABLE "crm_labor_grade"
  ADD COLUMN IF NOT EXISTS "publicRateMinor" BIGINT,
  ADD COLUMN IF NOT EXISTS "effectiveFrom" DATE,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "crm_labor_grade" ADD CONSTRAINT "chk_labor_grade_amounts"
  CHECK ("costPerMmMinor" >= 0 AND ("pricePerMmMinor" IS NULL OR "pricePerMmMinor" >= 0) AND ("publicRateMinor" IS NULL OR "publicRateMinor" >= 0));

-- ── 견적 항목 ───────────────────────────────────────────────────────────
ALTER TABLE "crm_quote_line"
  ADD COLUMN IF NOT EXISTS "listPriceMinor" BIGINT,
  ADD COLUMN IF NOT EXISTS "priceSource" TEXT,
  ADD COLUMN IF NOT EXISTS "provenance" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "billing" TEXT,
  ADD COLUMN IF NOT EXISTS "ratioOfSectionName" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "lockedFields" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "chk_quote_line_billing" CHECK ("billing" IS NULL OR "billing" IN ('ONCE', 'ANNUAL'));
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "chk_quote_line_price_source"
  CHECK ("priceSource" IS NULL OR "priceSource" IN ('LIST', 'LABOR', 'GPU', 'COST_MARGIN', 'MANUAL'));
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "chk_quote_line_list_price" CHECK ("listPriceMinor" IS NULL OR "listPriceMinor" >= 0);

-- ── 견적 묶음 ───────────────────────────────────────────────────────────
ALTER TABLE "crm_quote_section"
  ADD COLUMN IF NOT EXISTS "roundingUnit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "roundingMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "businessTypeKey" TEXT;
ALTER TABLE "crm_quote_section" ADD CONSTRAINT "chk_quote_section_rounding"
  CHECK ("roundingUnit" IN (0, 1000, 10000, 100000, 1000000, 10000000));

-- ── 견적 ────────────────────────────────────────────────────────────────
ALTER TABLE "crm_quote"
  ADD COLUMN IF NOT EXISTS "budgetMinor" BIGINT,
  ADD COLUMN IF NOT EXISTS "budgetIncludesTax" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priceBasisDate" DATE,
  ADD COLUMN IF NOT EXISTS "autoFilled" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "annualMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sectionRoundingMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fillConditions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "crm_quote" ADD CONSTRAINT "chk_quote_budget" CHECK ("budgetMinor" IS NULL OR "budgetMinor" > 0);

-- ── 사업 유형 ───────────────────────────────────────────────────────────
ALTER TABLE "crm_business_type" ADD COLUMN IF NOT EXISTS "marginPct" DECIMAL(5,2);
ALTER TABLE "crm_business_type" ADD CONSTRAINT "chk_business_type_margin"
  CHECK ("marginPct" IS NULL OR ("marginPct" >= 0 AND "marginPct" < 100));

-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 ────────────────────────
ALTER TABLE crm_price_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_price_rule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_price_product FROM anon, authenticated;
REVOKE ALL ON crm_price_rule    FROM anon, authenticated;
REVOKE ALL ON crm_price_history FROM anon, authenticated;
