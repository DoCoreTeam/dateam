-- =============================================================================
-- 042_memo_discovery.sql
-- 메모 발견·처리 시스템: lifecycle 상태 + pgvector 임베딩
-- 대상: daily_logs 중 entry_type='note'
-- RLS: 기존 daily_logs 정책 그대로 사용 (본인+admin) — 변경 없음
-- =============================================================================

-- 1. pgvector 확장
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. daily_logs 컬럼 추가 (기존 컬럼 변경 없음)
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS memo_status      text CHECK (memo_status IN ('new', 'reviewed', 'actioned')),
  ADD COLUMN IF NOT EXISTS memo_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding        vector(768);

-- 3. 기존 note 행 백필: memo_status NULL → 'new'
UPDATE daily_logs SET memo_status = 'new'
  WHERE entry_type = 'note' AND memo_status IS NULL;

-- 4. 인덱스
-- 미확인 메모 위젯 조회: user + status + 시간순
CREATE INDEX IF NOT EXISTS idx_daily_logs_memo_status
  ON daily_logs (user_id, memo_status, logged_at DESC)
  WHERE entry_type = 'note';

-- pgvector 유사도 (cosine) — ivfflat
CREATE INDEX IF NOT EXISTS idx_daily_logs_embedding
  ON daily_logs USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
