-- =============================================================================
-- 004_org_content_extend.sql
-- org_content CHECK 제약 확장 + 누락 키 추가
-- dashboard.html INIT_DATA의 모든 섹션을 DB에서 관리하도록 확장
-- =============================================================================

-- 1. 기존 CHECK 제약 제거 후 재생성 (확장된 key 목록)
ALTER TABLE org_content
  DROP CONSTRAINT IF EXISTS org_content_key_check;

ALTER TABLE org_content
  ADD CONSTRAINT org_content_key_check CHECK (key IN (
    'META',
    'projects',
    'members',
    'missions',
    'okr',
    'principles',
    'rhythm',
    'kpi_targets',
    'routine_templates',
    'dev_split',
    -- 추가 키
    'h1_kpi',
    'year_kpi',
    'ext_slots',
    'kpi_chart',
    'org_chart',
    'rr_matrix',
    'rr_biz',
    'routines'
  ));

-- 2. 새 키 초기 시딩
INSERT INTO org_content (key, value) VALUES
  ('h1_kpi',    '[]'),
  ('year_kpi',  '[]'),
  ('ext_slots', '[]'),
  ('kpi_chart', '{}'),
  ('org_chart', '{}'),
  ('rr_matrix', '[]'),
  ('rr_biz',    '[]'),
  ('routines',  '[]')
ON CONFLICT (key) DO NOTHING;
