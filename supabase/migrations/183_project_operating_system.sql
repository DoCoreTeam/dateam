-- 183: 프로젝트 실행 단위 + 범용 관계 + AI 작업공간 통합 키
ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS work_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_projects_work_project
  ON ai_projects(work_project_id) WHERE work_project_id IS NOT NULL AND deleted_at IS NULL;
INSERT INTO ai_projects(user_id,name,work_project_id)
SELECT p.user_id,p.name,p.id FROM projects p JOIN profiles u ON u.id=p.user_id AND u.role='admin'
WHERE p.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM ai_projects a WHERE a.work_project_id=p.id AND a.deleted_at IS NULL);

CREATE TABLE IF NOT EXISTS project_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('milestone','task','risk','decision')), title text NOT NULL,
  detail text, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','blocked','done','accepted','mitigated')),
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL, due_date date, created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_project_items_project ON project_items(project_id, kind, created_at) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_project_items_updated_at ON project_items;
CREATE TRIGGER trg_project_items_updated_at BEFORE UPDATE ON project_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_items_select ON project_items FOR SELECT TO authenticated USING(private.can_read_project(project_id));
CREATE POLICY project_items_insert ON project_items FOR INSERT TO authenticated WITH CHECK(private.can_manage_project(project_id) AND created_by=auth.uid());
CREATE POLICY project_items_update ON project_items FOR UPDATE TO authenticated USING(private.can_manage_project(project_id)) WITH CHECK(private.can_manage_project(project_id));
CREATE POLICY project_items_delete ON project_items FOR DELETE TO authenticated USING(private.can_manage_project(project_id));

CREATE TABLE IF NOT EXISTS project_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK(entity_type IN ('daily_log','meeting_note','weekly_report','ai_project','account','deal')),
  entity_id uuid NOT NULL, label text, created_by uuid NOT NULL REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS idx_project_relations_project ON project_relations(project_id,entity_type);
ALTER TABLE project_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_relations_select ON project_relations FOR SELECT TO authenticated USING(private.can_read_project(project_id));
CREATE POLICY project_relations_insert ON project_relations FOR INSERT TO authenticated WITH CHECK(private.can_manage_project(project_id) AND created_by=auth.uid());
CREATE POLICY project_relations_update ON project_relations FOR UPDATE TO authenticated USING(private.can_manage_project(project_id)) WITH CHECK(private.can_manage_project(project_id));
CREATE POLICY project_relations_delete ON project_relations FOR DELETE TO authenticated USING(private.can_manage_project(project_id));

INSERT INTO project_relations(project_id,entity_type,entity_id,label,created_by)
SELECT id,'account',account_id,'연결 거래처',user_id FROM projects WHERE account_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO project_relations(project_id,entity_type,entity_id,label,created_by)
SELECT id,'deal',origin_deal_id,'원본 영업기회',user_id FROM projects WHERE origin_deal_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO project_relations(project_id,entity_type,entity_id,label,created_by)
SELECT work_project_id,'ai_project',id,'AI 작업공간',user_id FROM ai_projects WHERE work_project_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;
