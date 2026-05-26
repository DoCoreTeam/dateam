-- 서비스 롤이 RLS를 우회하므로 모든 인증 사용자가 INSERT 가능한 취약 정책 제거
DROP POLICY IF EXISTS "service_insert_token_logs" ON ai_token_logs;
