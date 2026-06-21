-- =============================================================================
-- 127_review_items_evidence.sql
-- 원본데이터 보관 연결(v0.7.235): review_items에 evidence_drive_file_id 추가.
--   통합입력으로 업로드한 원본 파일(xlsx/pdf/img)을 Google Drive에 보관한 뒤
--   그 Drive file id를 검토 항목에 연결 → 확정 시 supply_quotes.evidence_drive_file_id로 전파.
--   이로써 "나중에 견적 뽑을 때 원본을 다시 열어 확인" 가능(역추적).
-- 비파괴: NULL 허용. Drive 미연결 환경에서는 NULL로 남고 추출은 정상 진행.
-- =============================================================================
ALTER TABLE review_items
  ADD COLUMN IF NOT EXISTS evidence_drive_file_id text;

COMMENT ON COLUMN review_items.evidence_drive_file_id IS '업로드 원본파일의 Google Drive file id — 확정 시 supply_quotes로 전파';
