-- ============================================================
-- 023: daily_logs flow_reason — AI 파생 관계 설명
-- ============================================================

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS flow_reason TEXT;
