-- 327: 계약 모듈 (P0184 I06)
--
-- 계약서는 공통 조항 위에 모듈을 얹어 조립한다. 모듈은 조항 키의 순서 있는 묶음이다
--   COMMON         공통 조항 (목적 정의 비밀유지 손해배상 … 준거법). 조립의 바탕
--   PERFORMANCE    급부: 무엇을 주나 (물품, SW 사용권, 유지보수, GPU 임대 …), 한 계약에 여럿
--   CONSIDERATION  대가: 어떻게 받나 (일시 분할 정액 사용량 …)
--   REGULATION     규제: 조건이 맞으면 켜진다 (enableWhen)
--   ANNEX          부속서: 조 번호 밖에 붙는다
--
-- 모듈은 조항 본문을 들지 않고 키만 든다. 본문은 조항 라이브러리(326)의 승인본에서 읽는다
-- 같은 글이 두 곳에 있으면 고친 쪽과 안 고친 쪽이 갈린다
--
-- 되돌리기: DROP TABLE crm_contract_module;

CREATE TABLE "crm_contract_module" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL CHECK ("key" ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
    "kind" TEXT NOT NULL
      CHECK ("kind" IN ('COMMON', 'PERFORMANCE', 'CONSIDERATION', 'REGULATION', 'ANNEX')),
    "title" TEXT NOT NULL,
    "clauseKeys" TEXT[] NOT NULL DEFAULT '{}',
    -- 켜는 조건 {"all":[{"field":"direction","op":"in","values":["SALES"]}]}, null 이면 고를 때만
    "enableWhen" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_module_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_contract_module_ws_key_key" ON "crm_contract_module"("workspaceId", "key");
CREATE INDEX "crm_contract_module_ws_kind_position_idx" ON "crm_contract_module"("workspaceId", "kind", "position");
ALTER TABLE "crm_contract_module" ADD CONSTRAINT "crm_contract_module_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 (S1) ─────────────────
ALTER TABLE crm_contract_module ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_contract_module FROM anon, authenticated;
