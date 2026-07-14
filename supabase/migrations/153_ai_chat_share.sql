-- 153_ai_chat_share.sql — admin 경계 내 공유 옵트인 (확정)
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE;     -- gen_random_uuid()::text, 서버에서 발급
CREATE INDEX IF NOT EXISTS idx_ai_conversations_share_token
  ON ai_conversations (share_token) WHERE shared = true AND deleted_at IS NULL;
-- RLS 변경 없음: owner 기본격리 유지. 공유 열람은 서버(service_role)가
-- shared=true + token 일치 검증 후 read-only로 제공(§5-2). 정책 완화 금지.
