-- daily_logs: 팀원 일일 업무 타임라인
-- 본인 + 관리자만 열람 (팀 공유 없음)

CREATE TABLE IF NOT EXISTS daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  logged_at timestamptz DEFAULT now(),
  content text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('done', 'doing', 'planned', 'blocker', 'note')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_logs_user_date ON daily_logs (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS daily_logs_date ON daily_logs (log_date DESC);

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- 본인 + 관리자 열람
CREATE POLICY daily_logs_select ON daily_logs
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- 본인만 작성
CREATE POLICY daily_logs_insert ON daily_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 본인만 수정
CREATE POLICY daily_logs_update ON daily_logs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 본인만 삭제
CREATE POLICY daily_logs_delete ON daily_logs
  FOR DELETE USING (user_id = auth.uid());
