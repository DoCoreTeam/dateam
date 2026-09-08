-- 242: 사업 유형을 «코드»에서 «데이터»로 내린다
--
-- **왜 지금인가**(사용자 지적 2026-09-08: 「사업유형 설정하는 곳이 없어」):
-- 파이프라인·단계·거래 조건·인건비 등급은 전부 워크스페이스 테이블이라 화면에서 관리한다.
-- 그런데 **사업 유형만** `CrmBusinessType` enum + 코드 상수라 화면 어디서도 손댈 수 없었다.
-- 「유지보수」 사업을 「기타」로 적을 수밖에 없었던 것이 그 결과다 — 유형이 «기타»면
-- 「어떤 사업이 남는 장사였나」에 영원히 답할 수 없다.
--
-- **추가 전용(expand)**. 기존 enum 칼럼은 그대로 두고 텍스트 칼럼을 나란히 연다(M-4).
-- 되돌리기: 이 파일 맨 아래 주석의 SQL 3줄이면 원상 복구된다.

-- ── ① 유형 목록 자체가 테이블이 된다 ────────────────────────────
CREATE TABLE IF NOT EXISTS crm_business_type (
  id            TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES crm_workspace(id) ON DELETE CASCADE,
  -- 딜에 **저장되는 값**. 기본 8종은 예전 enum 문자열과 같아야 백필이 맞는다.
  -- 사용자가 추가한 유형은 행 id 를 그대로 쓴다 — 이름을 바꿔도 저장된 값이 안 흔들린다.
  key           TEXT NOT NULL,
  -- 화면에 보이는 이름. 이것만 바뀐다
  label         TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  -- 기본 8종인가 — 기본은 지울 수 없고 «숨김»만 된다(예전 딜이 이 값을 가리키고 있다)
  "isBuiltin"   BOOLEAN NOT NULL DEFAULT false,
  -- 새 딜에서 고를 수 있나. 끄면 목록에서 빠지지만 **이미 그 유형인 딜은 그대로 보인다**
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"   TIMESTAMPTZ
);

-- 같은 워크스페이스에 같은 키가 둘일 수 없다. 살아 있는 행에만 건다 —
-- 지운 유형과 같은 이름을 다시 만들 수 있어야 한다
CREATE UNIQUE INDEX IF NOT EXISTS crm_business_type_ws_key_uniq
  ON crm_business_type("workspaceId", key) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS crm_business_type_ws_pos_idx
  ON crm_business_type("workspaceId", position);

-- ── ② 기본 8종을 워크스페이스마다 심는다 ─────────────────────────
-- 라벨은 `lib/terms/ledger.ts` 의 BUSINESS_TYPE_LABEL 과 같은 값이다.
-- 이제부터 그 상수는 «처음 심는 값»일 뿐이고, 진실은 이 표다.
INSERT INTO crm_business_type (id, "workspaceId", key, label, position, "isBuiltin", "isActive")
SELECT
  'bt_' || w.id || '_' || v.key,
  w.id, v.key, v.label, v.pos, true, true
FROM crm_workspace w
CROSS JOIN (VALUES
  ('GPU',      'GPU',        0),
  ('SI',       'SI',         1),
  ('SOLUTION', '솔루션',      2),
  ('HARDWARE', '하드웨어',    3),
  ('MSP',      'MSP',        4),
  ('PROJECT',  '국책',        5),
  ('CREDIT',   '크레딧 충전', 6),
  ('OTHER',    '기타',        7)
) AS v(key, label, pos)
ON CONFLICT DO NOTHING;

-- ── ③ 딜·거래조건이 그 표를 가리킨다 ────────────────────────────
-- enum 칼럼은 값을 지울 수 없어(Postgres) 사용자 추가 유형을 담지 못한다.
-- 그래서 텍스트 칼럼을 열고 기존 값을 그대로 옮긴다. **손실 없음.**
ALTER TABLE crm_deal       ADD COLUMN IF NOT EXISTS "businessTypeKey" TEXT;
ALTER TABLE crm_quote_term ADD COLUMN IF NOT EXISTS "businessTypeKey" TEXT;

UPDATE crm_deal SET "businessTypeKey" = "businessType"::text
 WHERE "businessType" IS NOT NULL AND "businessTypeKey" IS NULL;
UPDATE crm_quote_term SET "businessTypeKey" = "businessType"::text
 WHERE "businessType" IS NOT NULL AND "businessTypeKey" IS NULL;

CREATE INDEX IF NOT EXISTS crm_deal_ws_biztype_idx
  ON crm_deal("workspaceId", "businessTypeKey");

COMMENT ON COLUMN crm_deal."businessTypeKey" IS
  '사업 유형 키 — crm_business_type.key. 예전 enum 칼럼 businessType 은 기본 8종일 때만 함께 채워진다(expand 중간 상태)';
COMMENT ON TABLE crm_business_type IS
  '워크스페이스별 사업 유형 목록. 영업 CRM 설정에서 관리한다';

-- ── ④ RLS — crm_ 테이블의 두 번째 벽(199 와 같은 방식) ──────────
ALTER TABLE crm_business_type ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_business_type_tenant" ON "crm_business_type";
CREATE POLICY "crm_business_type_tenant" ON "crm_business_type" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

-- 되돌리기(필요할 때만):
--   DROP TABLE crm_business_type;
--   ALTER TABLE crm_deal DROP COLUMN "businessTypeKey";
--   ALTER TABLE crm_quote_term DROP COLUMN "businessTypeKey";
