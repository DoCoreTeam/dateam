-- 100_ai_feedback_signals.sql
-- Slice 1: AI 자동셋팅 결과에 대한 "사용자 교정 신호" 수집(되먹임은 후속 슬라이스).
--   사용자가 AI 파생 일일업무(ai_processed=true)를 삭제/수정/캘린더취소 할 때 그 행동을
--   신호로 적재한다. reject(삭제)/correct_*(수정)/schedule_reject(캘린더 취소).
--   원본 daily_logs 는 비파괴 — 신호는 별도 테이블 INSERT(best-effort, 본 흐름 안 막음).
-- 멱등: create table if not exists + DROP POLICY IF EXISTS. migrate.sh atomic 추적.
-- RLS: 본인만 select/insert (전역 집계는 후속 슬라이스에서 admin/service client).

CREATE TABLE IF NOT EXISTS ai_feedback_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_id          uuid REFERENCES daily_logs(id) ON DELETE SET NULL,  -- 삭제돼도 신호 보존
  origin_group_id uuid,
  prompt_version  text,
  signal_type     text NOT NULL CHECK (signal_type IN
                   ('reject','correct_content','correct_type','correct_date','schedule_reject','accept','split_reject')),
  field           text,
  before_value    text,
  after_value     text,
  original_input  text,
  ai_confidence   numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_afs_user_created ON ai_feedback_signals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_afs_type ON ai_feedback_signals (signal_type, created_at DESC);

COMMENT ON TABLE ai_feedback_signals IS 'AI 자동셋팅 결과에 대한 사용자 교정 신호(Slice 1: 수집만). 후속 슬라이스에서 집계·되먹임.';

ALTER TABLE ai_feedback_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS afs_select ON ai_feedback_signals;
CREATE POLICY afs_select ON ai_feedback_signals FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS afs_insert ON ai_feedback_signals;
CREATE POLICY afs_insert ON ai_feedback_signals FOR INSERT WITH CHECK (user_id = auth.uid());

-- 롤백: DROP TABLE IF EXISTS ai_feedback_signals;
