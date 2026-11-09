-- 326: 조항 라이브러리 (P0184 I05)
--
-- 계약서를 통째 템플릿이 아니라 조항을 골라 조립한다. 조항 하나가 한 행이고
-- (워크스페이스, 키, 언어, 버전 번호) 가 그 행의 자리다.
--
-- 상태 둘: 초안(DRAFT) 승인(APPROVED)
--   초안은 고친다. 승인은 관리자만 하고, 승인된 본문은 **고치지 않는다**
--   승인본을 고치려 하면 서비스가 다음 번호의 초안을 새로 만든다. 그래야 이미 그 승인본을
--   기준으로 판정한 계약(표준 이탈 판정, I08)의 근거가 바뀌지 않는다
--   이 규칙은 서비스만 믿지 않고 아래 트리거가 한 번 더 막는다
--
-- 되돌리기: DROP TABLE crm_contract_clause; DROP FUNCTION crm_contract_clause_guard();

CREATE TABLE "crm_contract_clause" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL CHECK ("key" ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
    "lang" TEXT NOT NULL DEFAULT 'ko' CHECK ("lang" IN ('ko', 'en')),
    "versionNo" INTEGER NOT NULL DEFAULT 1 CHECK ("versionNo" >= 1),
    "title" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'APPROVED')),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_clause_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_contract_clause_approved_has_approver"
      CHECK ("status" <> 'APPROVED' OR "approvedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "crm_contract_clause_ws_key_lang_ver_key"
  ON "crm_contract_clause"("workspaceId", "key", "lang", "versionNo");
-- 한 조항에 초안은 하나뿐 — 둘이면 어느 쪽을 승인할지 모른다
CREATE UNIQUE INDEX "crm_contract_clause_one_draft_key"
  ON "crm_contract_clause"("workspaceId", "key", "lang") WHERE "status" = 'DRAFT';
CREATE INDEX "crm_contract_clause_ws_status_idx" ON "crm_contract_clause"("workspaceId", "status");
ALTER TABLE "crm_contract_clause" ADD CONSTRAINT "crm_contract_clause_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 승인본은 고치지도 지우지도 않는다 ─────────────────────────────────
CREATE OR REPLACE FUNCTION crm_contract_clause_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."status" = 'APPROVED' THEN
    RAISE EXCEPTION '승인된 조항은 고치거나 지우지 않습니다. 고치려면 다음 버전 초안을 만드세요 (%)', OLD."key"
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_contract_clause_lock
  BEFORE UPDATE OR DELETE ON crm_contract_clause
  FOR EACH ROW EXECUTE FUNCTION crm_contract_clause_guard();

REVOKE ALL ON FUNCTION crm_contract_clause_guard() FROM anon, authenticated, public;

-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 (S1) ─────────────────
ALTER TABLE crm_contract_clause ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_contract_clause FROM anon, authenticated;
