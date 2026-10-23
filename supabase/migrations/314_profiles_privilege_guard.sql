-- 314 profiles 권한 칸 잠금
--
-- 왜: profiles_update 정책(001)이 USING (auth.uid() = id OR admin) 하나뿐이고 칸 제한이 없었다.
--   로그인한 사람은 누구나 자기 행의 role 을 'admin' 으로 바꿀 수 있었다(감사 2026-10-23).
--   is_admin() 과 role = 'admin' 을 보는 모든 정책이 이 칸을 믿으므로, 한 줄로 전권을 얻는다.
--   같은 길로 must_change_password 를 끄고 deleted_at 을 지워 퇴사 처리도 되돌릴 수 있었다.
--
-- 어떻게: 정책은 칸을 못 가리므로 BEFORE 트리거로 막는다.
--   관리자(is_admin), 서비스롤, JWT 없는 서버 연결(auth.uid() 가 null, 가입 트리거 포함)은 통과.
--   그 밖의 사람은 권한 칸을 바꿀 수 없고, 새 행은 member 로만 만들 수 있다.
--   본인이 바꿔도 되는 칸(name, theme_preference, onboarding_*)은 그대로 둔다.
--
-- 되돌리기: DROP TRIGGER trg_profiles_privilege_guard ON public.profiles;
--           DROP FUNCTION public.profiles_privilege_guard();

CREATE OR REPLACE FUNCTION public.profiles_privilege_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'member' OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'profiles: 권한 칸은 관리자만 정할 수 있습니다' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     OR NEW.rank IS DISTINCT FROM OLD.rank
     OR NEW.position IS DISTINCT FROM OLD.position THEN
    RAISE EXCEPTION 'profiles: 권한 칸은 관리자만 바꿀 수 있습니다' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_privilege_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_privilege_guard ON public.profiles;
CREATE TRIGGER trg_profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_privilege_guard();
