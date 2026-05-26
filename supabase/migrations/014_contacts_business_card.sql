-- =============================================================================
-- 014_contacts_business_card.sql
-- contacts 테이블에 명함 Google Drive 파일 ID 컬럼 추가
--
-- [system_settings RLS 검토]
-- 008_system_settings.sql 정책:
--   - system_settings_public_read : FOR SELECT USING (true) → 비인증 포함 전체 읽기 가능
--   - system_settings_admin_write : FOR ALL TO authenticated
--       USING/WITH CHECK (profiles.role = 'admin') → admin이 모든 key 삽입/수정/삭제 가능
-- → google_drive_* 접두어 키(google_drive_folder_id, google_drive_credentials 등)도
--   동일 정책 적용 대상이므로 별도 스키마 변경 없이 admin read/write 가능.
--   단, google_drive_credentials 같은 민감 값은 value를 암호화하거나
--   Secret Manager에 저장하고 key만 참조하도록 앱 레이어에서 처리 권장.
-- =============================================================================

-- contacts 테이블에 명함 Drive 파일 ID 컬럼 추가 (nullable)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS business_card_drive_id TEXT;

-- 명함 이미지 검색용 인덱스 (NULL이 아닌 row만 인덱싱)
CREATE INDEX IF NOT EXISTS idx_contacts_business_card_drive_id
  ON contacts (business_card_drive_id)
  WHERE business_card_drive_id IS NOT NULL;
