-- 097: 개인별 디자인 테마 선택 (profiles.theme_preference)
-- 어드민은 전역 디폴트(system_settings.active_theme)를 관리하고,
-- 각 사용자는 본인 테마를 선택할 수 있다. NULL = 전역 디폴트 추종.
-- 값 검증은 앱 계층(isThemeId 화이트리스트)에서 수행 — 신규 테마 추가 시 마이그레이션 불필요.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_preference text;

COMMENT ON COLUMN profiles.theme_preference IS
  '개인 선택 디자인 테마 id (themes 레지스트리). NULL이면 전역 디폴트(system_settings.active_theme) 추종.';
