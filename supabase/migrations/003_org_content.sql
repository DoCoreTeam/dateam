-- =============================================================================
-- 003_org_content.sql
-- newAX Platform — Org Content Table
-- =============================================================================
-- 조직 단위 콘텐츠 저장소 (key-value JSONB 구조)
-- admin만 쓰기 가능, authenticated 사용자 전체 읽기 가능
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. org_content
--    조직 공통 데이터를 key별 JSONB로 보관하는 싱글톤 행 테이블
--    허용 key: META | projects | members | missions | okr |
--              principles | rhythm | kpi_targets | routine_templates | dev_split
-- ---------------------------------------------------------------------------
CREATE TABLE org_content (
  key        TEXT        PRIMARY KEY
                         CHECK (key IN (
                           'META',
                           'projects',
                           'members',
                           'missions',
                           'okr',
                           'principles',
                           'rhythm',
                           'kpi_targets',
                           'routine_templates',
                           'dev_split'
                         )),
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID        REFERENCES profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE  org_content            IS '조직 단위 콘텐츠 저장소. 각 행이 특정 도메인 데이터의 최신 스냅샷을 JSONB로 보관한다.';
COMMENT ON COLUMN org_content.key        IS '도메인 식별자. CHECK 제약으로 허용 값 제한.';
COMMENT ON COLUMN org_content.value      IS '도메인 데이터 페이로드. 형식은 key별로 다를 수 있다.';
COMMENT ON COLUMN org_content.updated_at IS '마지막 수정 시각. 트리거로 자동 갱신.';
COMMENT ON COLUMN org_content.updated_by IS '마지막으로 수정한 admin 사용자의 profiles.id.';

-- ---------------------------------------------------------------------------
-- 2. updated_at 자동 갱신 트리거
--    set_updated_at() 함수는 001_initial_schema.sql에서 이미 정의됨 → 재사용
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_org_content_updated_at
  BEFORE UPDATE ON org_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 인덱스
--    - PK(key)로 단건 조회가 대부분이므로 추가 인덱스는 최소화
--    - updated_by: admin 활동 감사(audit) 및 JOIN 최적화 목적
-- ---------------------------------------------------------------------------
CREATE INDEX idx_org_content_updated_by
  ON org_content (updated_by)
  WHERE updated_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE org_content ENABLE ROW LEVEL SECURITY;

-- SELECT: 로그인한 모든 사용자
CREATE POLICY org_content_select
  ON org_content FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT: admin만 허용
CREATE POLICY org_content_insert
  ON org_content FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- UPDATE: admin만 허용
CREATE POLICY org_content_update
  ON org_content FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- DELETE: admin만 허용
CREATE POLICY org_content_delete
  ON org_content FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 5. 초기 행 시딩 (빈 payload로 미리 삽입 — 앱에서 upsert 시 key 충돌 방지)
-- ---------------------------------------------------------------------------
INSERT INTO org_content (key, value) VALUES
  ('META',               '{}'),
  ('projects',           '[]'),
  ('members',            '[]'),
  ('missions',           '[]'),
  ('okr',                '[]'),
  ('principles',         '[]'),
  ('rhythm',             '{}'),
  ('kpi_targets',        '[]'),
  ('routine_templates',  '[]'),
  ('dev_split',          '{}')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 롤백 전략 (파괴적 변경 없음 — 새 테이블 추가만)
-- 롤백 필요 시:
--   DROP TABLE IF EXISTS org_content;
-- =============================================================================
