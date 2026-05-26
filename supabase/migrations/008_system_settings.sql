-- 시스템 설정 테이블 (로고·브랜드명 등 key-value 저장)
CREATE TABLE IF NOT EXISTS system_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE NOT NULL,
  value      text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 전체 공개 읽기 (로그인 화면에서도 브랜딩 정보 필요)
CREATE POLICY "system_settings_public_read" ON system_settings
  FOR SELECT USING (true);

-- admin만 쓰기
CREATE POLICY "system_settings_admin_write" ON system_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
    )
  );

-- 기본값 seed
INSERT INTO system_settings (key, value) VALUES
  ('brand_name', 'AX사업본부'),
  ('logo_path',  null)
ON CONFLICT (key) DO NOTHING;

-- Storage: Supabase 대시보드에서 'branding' 버킷(public) 생성 필요
-- 또는 첫 업로드 시 API route에서 자동 생성
