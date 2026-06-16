-- 105: 일일→부서 승격 멱등 DB 강제(동시요청 race 방지) — 한 원본은 부서업무 1건만.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_task_promoted_from
  ON daily_logs(promoted_from_log_id)
  WHERE promoted_from_log_id IS NOT NULL AND task_kind = 'dept_task';
