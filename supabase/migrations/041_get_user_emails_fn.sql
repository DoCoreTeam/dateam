-- 서비스롤 전용: auth.users에서 이메일 조회
-- RLS 우회 필요 → SECURITY DEFINER + service_role 전용
CREATE OR REPLACE FUNCTION public.get_user_emails()
RETURNS TABLE(id uuid, email text)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = auth
AS $$
  SELECT id, email::text
  FROM auth.users
  WHERE deleted_at IS NULL
    AND email IS NOT NULL;
$$;

-- 일반 유저 실행 차단 (서비스롤만 가능)
REVOKE ALL ON FUNCTION public.get_user_emails() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_emails() TO service_role;
