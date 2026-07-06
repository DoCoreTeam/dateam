-- 142_project_activity.sql
-- A: 프로젝트 저장 이력(감사로그) — "작성했다는데 없다" 분쟁 대비 불변 로그.
--
-- 왜: projects는 성공/실패 어디에도 DB 영속 로그가 없어(실패는 console.error뿐)
--   사후에 "정말 저장 시도가 있었는지" 재구성이 불가능했다. 성공만이 아니라
--   시도 전체(성공/실패/부분)를 남기고, 성공 시 저장값(after) 스냅샷도 보관한다.
-- 설계: append-only(UPDATE/DELETE 정책 없음). weekly_report_activity(120)·gpu_audit_logs(024) 패턴 계승.

CREATE TABLE project_activity (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 생성 실패 시 아직 project id가 없고, 삭제 후에도 로그는 보존해야 하므로 nullable + SET NULL.
  project_id      UUID        REFERENCES projects (id) ON DELETE SET NULL,
  -- 조회 스코프(프로젝트 소유자). 생성 실패 시엔 시도한 본인.
  user_id         UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  actor_id        UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  action          TEXT        NOT NULL
                              CHECK (action IN ('create','update','delete','ai_confirm','link_daily','unlink_daily','member_change')),
  status          TEXT        NOT NULL DEFAULT 'success'
                              CHECK (status IN ('success','failure','partial')),
  before_snapshot JSONB,      -- 변경 전 값(update/delete)
  after_snapshot  JSONB,      -- 저장된 값(성공 시) — "DB에 저장됐다면 값도 보여주고"
  error_detail    JSONB,      -- 실패 원인(코드/메시지) 영속
  evidence        JSONB,      -- 요청 요약(이름·연결수 등) = "작성했다는 증거"
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()  -- 항상 UTC 저장, 표시 시 KST 변환
);

CREATE INDEX idx_project_activity_project ON project_activity (project_id, occurred_at DESC);
CREATE INDEX idx_project_activity_user    ON project_activity (user_id, occurred_at DESC);

ALTER TABLE project_activity ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인(소유자 또는 행위자)만. (admin 콘솔은 서비스롤 경로로 별도 조회)
CREATE POLICY project_activity_select ON project_activity
  FOR SELECT USING (user_id = auth.uid() OR actor_id = auth.uid());

-- INSERT: 행위자 본인 명의로만 기록(실패 로그도 actor = auth.uid()라 통과).
CREATE POLICY project_activity_insert ON project_activity
  FOR INSERT WITH CHECK (actor_id = auth.uid());

-- UPDATE/DELETE 정책 없음 → append-only 불변(감사 무결성).
