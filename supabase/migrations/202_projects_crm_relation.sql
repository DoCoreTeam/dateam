-- 202: 프로젝트 ↔ 영업 CRM 연결 (dacrm 정정판)
--
-- 왜: 프로젝트(업무)에는 이미 `account_id`·`origin_deal_id` 가 있는데
--     그건 **구 CRM**(accounts·deals)을 가리킨다. 실사용은 0건이고,
--     거래처 12건은 이미 crm_company 로 이관됐다.
--     그래서 프로젝트에서 "이 일이 어느 딜에서 왔나"를 물으면 답할 곳이 없었다.
--
-- 형태: **컬럼 추가만 한다(expand).** 기존 컬럼은 건드리지 않는다 —
--     지우면 되돌릴 수 없고, 남겨 두면 이관이 끝난 뒤 조용히 정리할 수 있다.
--     되돌리기는 DROP COLUMN 두 줄이다.
--
-- 주의: crm_company.id / crm_deal.id 는 cuid **text** 다(uuid 아님).
--     기존 account_id 가 uuid 라고 같은 타입으로 맞추면 FK 가 안 붙는다.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS crm_company_id text REFERENCES crm_company(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_deal_id    text REFERENCES crm_deal(id)    ON DELETE SET NULL;

COMMENT ON COLUMN projects.crm_company_id IS '영업 CRM 회사. 구 account_id 를 대체한다(구 컬럼은 이관 확인 후 정리)';
COMMENT ON COLUMN projects.crm_deal_id    IS '이 프로젝트가 시작된 딜. 구 origin_deal_id 를 대체한다';

-- 조회는 "이 딜에서 시작된 프로젝트" 방향이 많다 — 딜 상세가 그걸 묻는다
CREATE INDEX IF NOT EXISTS idx_projects_crm_deal    ON projects(crm_deal_id)    WHERE crm_deal_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_crm_company ON projects(crm_company_id) WHERE crm_company_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 리드 인테이크 → CRM 이관 표시
--
-- 리드 1,517건은 CRM 에 대응이 없어 프로젝트관리를 은퇴시킬 수 없었다.
-- 이관을 한 번에 하지 않고 **이관된 것을 표시**하는 방식으로 간다 —
-- 1,517건을 한꺼번에 밀어 넣으면 잘못됐을 때 되돌릴 방법이 없다.
-- 사람이 하나씩(또는 골라서) 옮기고, 옮긴 것에 자국을 남긴다.

ALTER TABLE lead_intakes
  ADD COLUMN IF NOT EXISTS crm_company_id text REFERENCES crm_company(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_person_id  text REFERENCES crm_person(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_deal_id    text REFERENCES crm_deal(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_migrated_at timestamptz;

COMMENT ON COLUMN lead_intakes.crm_migrated_at IS '영업 CRM 으로 옮긴 시각. NULL 이면 아직 안 옮긴 리드다';

-- "아직 안 옮긴 리드"를 묻는 화면이 생긴다 — 그게 이관의 진척이다
CREATE INDEX IF NOT EXISTS idx_lead_intakes_crm_pending
  ON lead_intakes(user_id, created_at DESC) WHERE crm_migrated_at IS NULL;
