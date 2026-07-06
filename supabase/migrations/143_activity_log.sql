-- 143_activity_log.sql
-- 통합 활동이력 SSOT — 업무 허브 전 모듈(일일/부서, 그리고 향후)의 저장 활동을 한 테이블에.
--
-- 왜: 사용자는 일일업무·주간보고·부서업무·프로젝트의 "모든 활동 이력"을 한 탭에서 보길 원함.
--   주간(weekly_report_activity·120)·프로젝트(project_activity·142)는 이미 각자 로깅되므로,
--   여기서는 로깅이 없던 daily_logs 기반 모듈(일일업무·부서업무)을 이 테이블에 기록하고,
--   '이력' 탭 API가 세 소스(activity_log + project_activity + weekly_report_activity)를 UNION해 한 피드로 보여준다.
-- 설계: project_activity 스키마를 계승(action/status/before/after/error/evidence). append-only.

CREATE TABLE activity_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  module          TEXT        NOT NULL CHECK (module IN ('daily', 'dept_task')),
  entity_id       UUID,       -- daily_logs.id (생성 실패 시 null)
  user_id         UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,  -- 조회 스코프(소유자)
  actor_id        UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,  -- 행위자
  action          TEXT        NOT NULL,   -- create|update|delete|status_change|assign|promote|carryover|memo
  status          TEXT        NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure', 'partial')),
  title           TEXT,       -- 사람이 읽는 요약(내용 스니펫 등)
  before_snapshot JSONB,
  after_snapshot  JSONB,
  error_detail    JSONB,
  evidence        JSONB,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_log_user      ON activity_log (user_id, occurred_at DESC);
CREATE INDEX idx_activity_log_actor     ON activity_log (actor_id, occurred_at DESC);
CREATE INDEX idx_activity_log_module    ON activity_log (module, occurred_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인(소유자 또는 행위자)만.
CREATE POLICY activity_log_select ON activity_log
  FOR SELECT USING (user_id = auth.uid() OR actor_id = auth.uid());

-- INSERT: 행위자 본인 명의로만.
CREATE POLICY activity_log_insert ON activity_log
  FOR INSERT WITH CHECK (actor_id = auth.uid());

-- UPDATE/DELETE 정책 없음 → append-only 불변.
