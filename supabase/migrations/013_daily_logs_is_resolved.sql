-- daily_logs: is_resolved 컬럼 추가 (이월 항목 해결 여부 추적)
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS is_resolved boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_daily_logs_unresolved
  ON daily_logs(user_id, log_date, is_resolved)
  WHERE is_resolved = false;
