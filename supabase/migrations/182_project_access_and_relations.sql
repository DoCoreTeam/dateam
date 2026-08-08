-- 182: 프로젝트 기본 비공개 공유 + CRM 관계 + 참여자
-- 기존 행은 visibility=private로 유지해 노출 범위를 넓히지 않는다.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS success_criteria text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES org_nodes(id) ON DELETE SET NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_visibility_check;
ALTER TABLE projects ADD CONSTRAINT projects_visibility_check
  CHECK (visibility IN ('private','members','department','organization','admin_only'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_department_visibility_check;
ALTER TABLE projects ADD CONSTRAINT projects_department_visibility_check
  CHECK (visibility <> 'department' OR department_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deal ON projects(origin_deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'contributor'
    CHECK (role IN ('owner','manager','contributor','viewer','stakeholder')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);
-- 111에서 이미 생성된 환경에도 신규 계약을 증분 적용한다.
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
UPDATE project_members SET role = 'contributor'
WHERE role IS NULL OR role NOT IN ('owner','manager','contributor','viewer','stakeholder');
ALTER TABLE project_members ALTER COLUMN role SET DEFAULT 'contributor';
ALTER TABLE project_members ALTER COLUMN role SET NOT NULL;
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('owner','manager','contributor','viewer','stakeholder'));
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_user_profile_fk;
ALTER TABLE project_members ADD CONSTRAINT project_members_user_profile_fk
  FOREIGN KEY(user_id) REFERENCES profiles(id) ON DELETE CASCADE NOT VALID;
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, project_id);
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- RLS 재귀를 피하는 단일 판정 SSOT. 프로젝트·멤버 정책이 모두 재사용한다.
CREATE OR REPLACE FUNCTION private.can_read_project(target_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = target_project_id AND p.deleted_at IS NULL AND (
      p.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL)
      OR (p.visibility = 'organization' AND EXISTS (
        SELECT 1 FROM profiles me
        WHERE me.id = auth.uid() AND me.role IN ('admin','member') AND me.deleted_at IS NULL
      ))
      OR (p.visibility IN ('members','department','organization') AND EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
      ))
      OR (p.visibility = 'department' AND p.department_id = ANY(private.my_readable_dept_ids()))
    )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_project(target_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = target_project_id AND p.deleted_at IS NULL AND (
      p.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL)
      OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_id = auth.uid() AND pm.role = 'manager'
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION private.can_read_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_read_project(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_manage_project(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT TO authenticated
  USING (private.can_read_project(id));

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE TO authenticated
  USING (private.can_manage_project(id))
  WITH CHECK (private.can_manage_project(id) AND (
    visibility <> 'department' OR department_id = ANY(private.my_readable_dept_ids()) OR EXISTS (
      SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL
    )
  ));

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (
    visibility <> 'department' OR department_id = ANY(private.my_readable_dept_ids()) OR EXISTS (
      SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL
    )
  ));

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS project_members_select ON project_members;
CREATE POLICY project_members_select ON project_members FOR SELECT TO authenticated
  USING (private.can_read_project(project_id));
DROP POLICY IF EXISTS project_members_insert ON project_members;
CREATE POLICY project_members_insert ON project_members FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_project(project_id) AND role <> 'owner');
DROP POLICY IF EXISTS project_members_update ON project_members;
CREATE POLICY project_members_update ON project_members FOR UPDATE TO authenticated
  USING (private.can_manage_project(project_id) AND role <> 'owner')
  WITH CHECK (private.can_manage_project(project_id) AND role <> 'owner');
DROP POLICY IF EXISTS project_members_delete ON project_members;
CREATE POLICY project_members_delete ON project_members FOR DELETE TO authenticated
  USING (private.can_manage_project(project_id) AND role <> 'owner');

-- 기존·신규 소유자를 owner 멤버로 동기화.
INSERT INTO project_members(project_id, user_id, role, created_by)
SELECT id, user_id, 'owner', user_id FROM projects
ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner';

CREATE OR REPLACE FUNCTION private.sync_project_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  INSERT INTO project_members(project_id, user_id, role, created_by)
  VALUES(NEW.id, NEW.user_id, 'owner', NEW.user_id)
  ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_projects_owner_member ON projects;
CREATE TRIGGER trg_projects_owner_member AFTER INSERT OR UPDATE OF user_id ON projects
FOR EACH ROW EXECUTE FUNCTION private.sync_project_owner_member();

-- 소유자 교체는 관리자 전용. 일반 manager가 직접 DB 요청으로 소유권을 탈취하는 경로를 차단한다.
CREATE OR REPLACE FUNCTION private.guard_project_owner_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.role = 'admin' AND me.deleted_at IS NULL)
  THEN RAISE EXCEPTION '프로젝트 소유자는 관리자만 변경할 수 있습니다';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_projects_guard_owner ON projects;
CREATE TRIGGER trg_projects_guard_owner BEFORE UPDATE OF user_id ON projects
FOR EACH ROW EXECUTE FUNCTION private.guard_project_owner_change();
