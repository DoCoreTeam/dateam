-- AI 토큰 사용량 로그 테이블
CREATE TABLE IF NOT EXISTS ai_token_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature         text NOT NULL,
  model           text NOT NULL,

  prompt_tokens   int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  total_tokens    int NOT NULL DEFAULT 0,

  success         boolean NOT NULL DEFAULT true,
  error_message   text
);

CREATE INDEX IF NOT EXISTS idx_ai_token_logs_user    ON ai_token_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_feature ON ai_token_logs(feature);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_created ON ai_token_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_month   ON ai_token_logs(date_trunc('month', created_at));

ALTER TABLE ai_token_logs ENABLE ROW LEVEL SECURITY;

-- 어드민만 읽기
CREATE POLICY "admin_read_token_logs" ON ai_token_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- service role (adminClient)만 삽입 — RLS 우회
CREATE POLICY "service_insert_token_logs" ON ai_token_logs
  FOR INSERT WITH CHECK (true);
