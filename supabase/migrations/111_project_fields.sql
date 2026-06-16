-- 111: 프로젝트 고도화 — projects 메타 필드 확장 + project_members 멤버십 테이블
--  목적: 109에서 만든 경량 projects 엔티티에 일정/예산/상태 메타를 더하고, 프로젝트에
--        참여하는 구성원(project_members)을 표현한다. 공개 임박 → additive·가역만.
--  설계: projects 추가 컬럼은 전부 nullable(또는 DEFAULT 보유) → 기존 행 무영향.
--        기존 컬럼/RLS/트리거/match_projects(109·110)는 일절 변경하지 않는다(보존).
--        project_members RLS는 소유자(projects.user_id) 기준 default-deny + 본인 멤버 self-read.
--  멱등(ADD COLUMN IF NOT EXISTS / IF NOT EXISTS / DROP POLICY IF EXISTS 후 CREATE).
--  CONCURRENTLY 미사용(마이그레이션 트랜잭션 안전).
--  참고 스타일: 109(projects·owner RLS), 101(default-deny RLS), 075(owner RLS).

-- 1) projects 메타 필드 추가 (전부 nullable / DEFAULT 보유 — 기존 행 무영향)
--    CHECK 제약은 NULL을 통과시키므로(SQL 3치 논리) 기존 NULL 행에 무해.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS year       int;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS quarter    int;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS half       text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS month      int;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date   date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget     numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS currency   text DEFAULT 'KRW';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status     text DEFAULT 'active';

-- 1-1) CHECK 제약 (멱등: DROP IF EXISTS 후 ADD). 명시적 이름 부여로 재실행 안전.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_quarter_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_quarter_check CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_half_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_half_check CHECK (half IS NULL OR half IN ('H1','H2'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_month_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_month_check CHECK (month IS NULL OR month BETWEEN 1 AND 12);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check CHECK (status IN ('active','planning','done','hold'));

-- 2) project_members — 프로젝트 참여 구성원
CREATE TABLE IF NOT EXISTS project_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- 2-1) 인덱스 — 프로젝트별 멤버 조회(JOIN/필터 1차 축)
CREATE INDEX IF NOT EXISTS idx_project_members_project
  ON project_members (project_id);

-- 2-2) RLS — 소유자 기준 default-deny. service_role 우회 정책 없음(BYPASSRLS 미부여).
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- SELECT: 프로젝트 소유자 OR 본인이 멤버인 행.
DROP POLICY IF EXISTS project_members_select ON project_members;
CREATE POLICY project_members_select ON project_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
        AND p.user_id = (SELECT auth.uid())
    )
    OR user_id = (SELECT auth.uid())
  );

-- INSERT: 프로젝트 소유자만.
DROP POLICY IF EXISTS project_members_insert ON project_members;
CREATE POLICY project_members_insert ON project_members FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- UPDATE: 프로젝트 소유자만 (USING + WITH CHECK 동일 조건 — 다른 프로젝트로 이동 차단).
DROP POLICY IF EXISTS project_members_update ON project_members;
CREATE POLICY project_members_update ON project_members FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- DELETE: 프로젝트 소유자만.
DROP POLICY IF EXISTS project_members_delete ON project_members;
CREATE POLICY project_members_delete ON project_members FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
        AND p.user_id = (SELECT auth.uid())
    )
  );
