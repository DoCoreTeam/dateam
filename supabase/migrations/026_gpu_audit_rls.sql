-- 026: gpu_audit_logs RLS — authenticated 사용자 INSERT 허용
-- API routes(anon key + session)에서 audit log 기록이 RLS로 막히는 문제 해결

CREATE POLICY "auth: write gpu_audit_logs"
  ON gpu_audit_logs FOR INSERT TO authenticated WITH CHECK (true);
