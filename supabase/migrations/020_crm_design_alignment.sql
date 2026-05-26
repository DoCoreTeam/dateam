-- CRM 설계서 정합성 보완
-- docs/2026-05-26-lead/gcube_리드관리_구조설계_v1.0.html 기준

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fit_reason TEXT;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_segment_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_segment_check
  CHECK (segment IS NULL OR segment IN ('T1', 'T2', '공공', '파트너', '엔터프라이즈', 'SMB', '스타트업'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_registration_number
  ON accounts(registration_number)
  WHERE registration_number IS NOT NULL AND registration_number <> '';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS funding_source TEXT,
  ADD COLUMN IF NOT EXISTS procurement_status TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE deal_activities
  ADD COLUMN IF NOT EXISTS ai_extracted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extracted_todos JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS extracted_events JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS suggested_stage TEXT;

ALTER TABLE lead_intakes
  ADD COLUMN IF NOT EXISTS supplement_questions JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS duplicate_flags JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS original_file_name TEXT,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_accounts_registration_number
  ON accounts(registration_number);

CREATE INDEX IF NOT EXISTS idx_deals_account_title
  ON deals(account_id, title);
