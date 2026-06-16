-- 104: 일일→부서 승격 참조(복제 아님). dept_task(daily_logs)가 원본 일일 행을 가리킴.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS promoted_from_log_id uuid REFERENCES daily_logs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_daily_logs_promoted_from ON daily_logs(promoted_from_log_id) WHERE promoted_from_log_id IS NOT NULL;
