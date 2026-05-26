-- 별도 OAuth 토큰 테이블 (service_role 전용)
-- system_settings는 SELECT USING (true) 정책으로 anon key에 노출됨 → 분리 필요
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text        NOT NULL UNIQUE,  -- 'google_drive'
  access_token  text        NOT NULL DEFAULT '',
  refresh_token text        NOT NULL DEFAULT '',
  token_expiry  text        NOT NULL DEFAULT '',
  account_email text        NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- admin만 읽기 (service_role은 RLS 우회)
CREATE POLICY "oauth_tokens_admin_read" ON oauth_tokens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- admin만 쓰기
CREATE POLICY "oauth_tokens_admin_write" ON oauth_tokens
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
