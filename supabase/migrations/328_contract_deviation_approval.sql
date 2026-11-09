-- 328: 표준 이탈 승인 (P0184 I08)
--
-- 표준 조항(조항 라이브러리 승인본, 계약서 템플릿 발행본)과 다른 조항이 든 계약 버전은
-- 관리자가 그 버전을 승인해야 체결된다 (사용자 결정 2026-11-09)
--
-- 승인은 **버전 하나와 그 지문(contentHash)** 에 붙는다. 승인 뒤 본문을 고치면 새 버전이 생기고
-- 그 버전에는 승인이 없다. 같은 번호라도 지문이 다르면 승인이 아니다
--
-- 관계: 계약이 소유한다 (계약을 지우면 승인 기록도 뜻이 없다, CASCADE)
-- 승인 기록은 고치지 않는다 — 고칠 수 있는 승인은 승인이 아니다. 계약이 있는 동안은 지우지도 않는다
--
-- 되돌리기: DROP TABLE crm_contract_deviation_approval; DROP FUNCTION crm_contract_deviation_approval_guard();

CREATE TABLE "crm_contract_deviation_approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    -- 승인할 때 본 이탈 목록 [{clauseId, reason}] — 무엇을 승인했는지가 남는다
    "deviations" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_deviation_approval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_contract_deviation_approval_contract_version_key"
  ON "crm_contract_deviation_approval"("contractId", "versionNo");
CREATE INDEX "crm_contract_deviation_approval_workspaceId_idx" ON "crm_contract_deviation_approval"("workspaceId");
ALTER TABLE "crm_contract_deviation_approval" ADD CONSTRAINT "crm_contract_deviation_approval_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "crm_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contract_deviation_approval" ADD CONSTRAINT "crm_contract_deviation_approval_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 승인 기록은 고치지 않고, 계약이 있는 동안은 지우지 않는다 ──────────
CREATE OR REPLACE FUNCTION crm_contract_deviation_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '이탈 승인 기록은 고치지 않습니다' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM crm_contract WHERE id = OLD."contractId") THEN
    RAISE EXCEPTION '계약이 있는 동안 이탈 승인 기록만 따로 지울 수 없습니다' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER crm_contract_deviation_approval_lock
  BEFORE UPDATE OR DELETE ON crm_contract_deviation_approval
  FOR EACH ROW EXECUTE FUNCTION crm_contract_deviation_approval_guard();

REVOKE ALL ON FUNCTION crm_contract_deviation_approval_guard() FROM anon, authenticated, public;

-- ── 잠금: RLS 를 같은 판에서 켜고 권한을 회수한다 (S1) ─────────────────
ALTER TABLE crm_contract_deviation_approval ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_contract_deviation_approval FROM anon, authenticated;
