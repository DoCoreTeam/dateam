-- daily_logs: AI 스마트 저장 관련 필드 추가
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS priority text CHECK (priority IN ('urgent', 'high', 'normal', 'low')) DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_processed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_confidence float,
  ADD COLUMN IF NOT EXISTS original_input text,
  ADD COLUMN IF NOT EXISTS linked_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_scheduled
  ON daily_logs(user_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_linked_account
  ON daily_logs(linked_account_id)
  WHERE linked_account_id IS NOT NULL;
