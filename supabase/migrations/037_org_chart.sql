-- =============================================================================
-- 037_org_chart.sql
-- 조직도: 회사 · 부서(트리) · 부서-멤버 매핑
-- RLS: 팀원 전체 읽기, admin만 쓰기
-- =============================================================================

-- 회사 정보 (단일 행, id=1 고정)
CREATE TABLE org_company (
  id          INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name        TEXT        NOT NULL DEFAULT '회사명',
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO org_company (id, name) VALUES (1, '회사명')
  ON CONFLICT (id) DO NOTHING;

-- 부서 (자기참조 트리)
CREATE TABLE org_departments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  description   TEXT,
  parent_id     UUID        REFERENCES org_departments(id) ON DELETE RESTRICT,
  display_order INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_org_departments_updated_at
  BEFORE UPDATE ON org_departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 부서-사용자 연결
CREATE TABLE org_department_members (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID        NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, user_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE org_company           ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_departments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_department_members ENABLE ROW LEVEL SECURITY;

-- 팀원 전체 읽기
CREATE POLICY "org_company_select" ON org_company
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );
CREATE POLICY "org_departments_select" ON org_departments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );
CREATE POLICY "org_dept_members_select" ON org_department_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

-- admin 쓰기
CREATE POLICY "org_company_update_admin" ON org_company
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );

CREATE POLICY "org_departments_insert_admin" ON org_departments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
CREATE POLICY "org_departments_update_admin" ON org_departments
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
CREATE POLICY "org_departments_delete_admin" ON org_departments
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );

CREATE POLICY "org_dept_members_insert_admin" ON org_department_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
CREATE POLICY "org_dept_members_delete_admin" ON org_department_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
