-- 229: 원가 모델(차수 2) + 견적 라인 6종(차수 3 일부)
--
-- 기획서 「원가에서 견적까지」 §03·§08 을 그대로 옮긴다.
--   · 원가 갈래 10 × 시점 3 — 표준 원가회계 분류를 쓴다(우리가 지어내면 회계·세무와 말이 안 통한다)
--   · 라인 종류 6 — 새 유형은 «종류를 하나 더» 더하면 되고 표·화면·계산은 그대로다
--
-- **왜 지금인가**: 지금 견적 라인은 「수량 × 단가」 한 종류뿐이라
-- M/M 견적서(투입 항목·역할·등급·공수·단가·금액)를 담을 수가 없다.
-- 원가는 아예 자리가 없어 마진이 계산되지 않는다.
--
-- 추가 전용(expand). 기존 라인은 kind='QUANTITY' 로 자동 분류된다(M-4).

-- ── 라인 종류 여섯 ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CrmQuoteLineKind" AS ENUM (
    'USAGE',     -- 사용량: GPU-hour 처럼 쓴 만큼
    'QUANTITY',  -- 수량: 개수 × 단가 (지금까지의 유일한 종류)
    'EFFORT',    -- 공수: M/M × 등급 단가 — 역할·등급이 함께 붙는다
    'LICENSE',   -- 라이선스: User × 기간
    'PERIOD',    -- 기간요금: 월 단가 × 개월
    'RATIO'      -- 비율: 다른 라인의 N%
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 원가 갈래 열 (대분류는 코드가 파생한다 — 표에 두면 둘이 어긋난다) ──
DO $$ BEGIN
  CREATE TYPE "CrmCostCategory" AS ENUM (
    -- 직접비 — 이 사업에만 쓴 돈
    'MATERIAL',     -- 재료비: GPU 매입 · 서버·스위치 소싱 · 라이선스 매입
    'LABOR',        -- 노무비: SI 투입 인력 · PM · 개발 — M/M × 등급단가
    'EXPENSE',      -- 경비: 출장 · 설치 · 운반 · 검사 · 회선
    -- 외주비
    'SUBCONTRACT',  -- 하도급: 구축·개발 외주
    'PARTNER_FEE',  -- 파트너 수수료: 인센티브 — 매출·원가의 %
    -- 간접비 — 여러 사업이 나눠 쓰는 돈
    'OVERHEAD',     -- 일반관리비: 통상 매출의 일정 %
    'INFRA',        -- 공통 인프라: 공용 서버·모니터링·라이선스 풀
    -- 기간·위험
    'FINANCE',      -- 금융비용: 선매입 후 후불 수금 사이의 자금 비용
    'WARRANTY',     -- 하자보수 충당: 「검수 후 1년 무상」 — 무상이지만 원가는 든다
    'CONTINGENCY'   -- 예비비: 환율·물가·범위 변경 대비
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 원가 시점 셋 — 같은 원가를 세 번 본다 ──────────────────────
DO $$ BEGIN
  CREATE TYPE "CrmCostStage" AS ENUM (
    'ESTIMATE',  -- 추정: 견적 시점. 틀려도 되지만 근거를 남긴다
    'COMMITTED', -- 확정: 계약 시점. 매입 견적서·계약서로 고정
    'ACTUAL'     -- 실적: 집행 시점. 추정과의 차이가 다음 견적의 정확도가 된다
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 원가를 어떻게 넣었나 ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CrmCostInputMode" AS ENUM (
    'AMOUNT',   -- 금액을 직접
    'EFFORT',   -- M/M × 등급 단가
    'RATIO'     -- 매출(또는 원가)의 %
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 인건비 등급 ────────────────────────────────────────────────
-- 등급별 M/M 단가. 「고급 소프트웨어 엔지니어 1.0 M/M」의 단가가 여기서 온다
CREATE TABLE IF NOT EXISTS crm_labor_grade (
  id             TEXT PRIMARY KEY,
  "workspaceId"  TEXT NOT NULL,
  name           TEXT NOT NULL,              -- 초급·중급·고급·특급
  "roleLabel"    TEXT,                       -- 소프트웨어 엔지니어 · UI/UX 디자이너 · PM
  "costPerMmMinor" BIGINT NOT NULL DEFAULT 0,  -- 우리가 쓰는 원가 (대외비)
  "pricePerMmMinor" BIGINT,                    -- 고객에게 제시하는 단가. 없으면 원가에 마진을 얹는다
  currency       CHAR(3) NOT NULL DEFAULT 'KRW',
  position       INT NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS crm_labor_grade_ws_idx ON crm_labor_grade("workspaceId", position);

-- ── 딜 원가 ────────────────────────────────────────────────────
-- **딜에 붙는다.** 견적 라인과는 선택적으로 연결된다(기획 결정 6: 순서 무관).
-- 견적 없이 원가만 쌓아도 되고, 나중에 견적을 만들어 연결하면 그때부터 마진이 계산된다.
CREATE TABLE IF NOT EXISTS crm_deal_cost (
  id             TEXT PRIMARY KEY,
  "workspaceId"  TEXT NOT NULL,
  "dealId"       TEXT NOT NULL REFERENCES crm_deal(id) ON DELETE CASCADE,
  -- 견적 라인에 붙었으면 그 라인의 마진이 계산된다. 안 붙어도 딜 전체 마진에는 들어간다
  "quoteLineId"  TEXT REFERENCES crm_quote_line(id) ON DELETE SET NULL,

  category       "CrmCostCategory" NOT NULL,
  stage          "CrmCostStage" NOT NULL DEFAULT 'ESTIMATE',
  "inputMode"    "CrmCostInputMode" NOT NULL DEFAULT 'AMOUNT',

  name           TEXT NOT NULL,
  "descriptionMd" TEXT,

  -- 계산 결과. 입력 방식이 무엇이든 **여기로 수렴한다**
  "amountMinor"  BIGINT NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL DEFAULT 'KRW',

  -- EFFORT 로 넣었을 때
  "laborGradeId" TEXT REFERENCES crm_labor_grade(id) ON DELETE SET NULL,
  "effortMm"     NUMERIC(10,2),

  -- RATIO 로 넣었을 때 (매출의 %·원가의 %)
  "ratioPct"     NUMERIC(7,4),
  "ratioBase"    TEXT,   -- 'REVENUE' | 'COST' — 무엇의 %인지

  -- 근거. 「추정」이라도 왜 그 숫자인지는 남는다
  "basisNote"    TEXT,

  "createdById"  TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS crm_deal_cost_deal_idx ON crm_deal_cost("dealId", category);
CREATE INDEX IF NOT EXISTS crm_deal_cost_line_idx ON crm_deal_cost("quoteLineId");

-- ── 견적 라인에 종류와 공수 필드 ───────────────────────────────
ALTER TABLE crm_quote_line
  ADD COLUMN IF NOT EXISTS kind "CrmQuoteLineKind" NOT NULL DEFAULT 'QUANTITY',
  -- 공수 라인: 역할과 등급이 품목 옆에 붙는다(사용자가 제시한 M/M 견적서 양식)
  ADD COLUMN IF NOT EXISTS "roleLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "laborGradeId" TEXT REFERENCES crm_labor_grade(id) ON DELETE SET NULL,
  -- 비율 라인: 어느 라인의 몇 %인지
  ADD COLUMN IF NOT EXISTS "ratioOfLineId" TEXT REFERENCES crm_quote_line(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "ratioPct" NUMERIC(7,4);

COMMENT ON COLUMN crm_quote_line.kind IS
  '라인 종류 6. 새 유형은 enum 에 하나 더 — 표·화면·계산은 그대로다(기획 §08)';

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE crm_labor_grade ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_cost   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_labor_grade FROM anon, authenticated;
REVOKE ALL ON crm_deal_cost   FROM anon, authenticated;
