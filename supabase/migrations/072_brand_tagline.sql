-- 로그인 페이지 부제목("본부 운영 플랫폼")을 admin 브랜딩 관리에서 편집 가능하도록 설정값 추가
-- system_settings는 key/value 구조 — 기본값만 시드, RLS는 008에서 이미 정의됨

INSERT INTO system_settings (key, value) VALUES
  ('brand_tagline', '본부 운영 플랫폼')
ON CONFLICT (key) DO NOTHING;
