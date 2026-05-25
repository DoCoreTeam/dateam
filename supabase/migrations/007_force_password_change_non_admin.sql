-- 비admin 전 직원 최초 로그인 시 비밀번호 변경 강제
-- admin(김도현 본부장)은 제외
UPDATE profiles
SET must_change_password = true
WHERE role != 'admin'
  AND deleted_at IS NULL;
