-- 전역 디자인 테마 설정. system_settings(키/값) 구조 재사용 — RLS는 008에서 정의됨.
INSERT INTO system_settings (key, value) VALUES
  ('active_theme', 'nb')
ON CONFLICT (key) DO NOTHING;
