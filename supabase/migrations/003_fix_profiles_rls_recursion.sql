-- 003: profiles RLS 무한 재귀 수정
-- 기존 profiles_select 정책이 profiles 테이블을 서브쿼리로 자기 참조하여
-- PostgREST JOIN 시 "infinite recursion detected in policy for relation profiles" 에러 발생
-- → 팀 앱 특성상 인증된 모든 멤버가 프로필 읽기 허용으로 단순화

DROP POLICY IF EXISTS profiles_select ON profiles;

CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);
