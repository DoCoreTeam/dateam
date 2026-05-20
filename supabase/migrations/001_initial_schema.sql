-- =============================================================================
-- 001_initial_schema.sql
-- newAX Platform — Initial Schema
-- =============================================================================
-- 테이블: profiles, weekly_reports, kpi_entries, routine_checks
-- RLS, 인덱스, 트리거 포함
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. 공통 헬퍼 함수: updated_at 자동 갱신
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles
--    Supabase auth.users 를 1:1 확장하는 공개 프로필 테이블
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id                   UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL DEFAULT '',
  role                 TEXT        NOT NULL DEFAULT 'member'
                                   CHECK (role IN ('admin', 'member')),
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 1-1. auth.users INSERT 시 profiles 자동 생성
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    'member'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auth_users_on_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. weekly_reports
--    사용자별 주간보고 (week_start 는 반드시 월요일)
-- ---------------------------------------------------------------------------
CREATE TABLE weekly_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  week_start  DATE        NOT NULL
                          CHECK (EXTRACT(DOW FROM week_start) = 1),
  category    TEXT        NOT NULL DEFAULT '',
  performance TEXT        NOT NULL DEFAULT '',
  plan        TEXT        NOT NULL DEFAULT '',
  issues      TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT uq_weekly_reports_user_week_category
    UNIQUE (user_id, week_start, category)
);

CREATE TRIGGER trg_weekly_reports_updated_at
  BEFORE UPDATE ON weekly_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_weekly_reports_user_week
  ON weekly_reports (user_id, week_start);

CREATE INDEX idx_weekly_reports_week
  ON weekly_reports (week_start);

-- ---------------------------------------------------------------------------
-- 3. kpi_entries
--    KPI 수치 기록
-- ---------------------------------------------------------------------------
CREATE TABLE kpi_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  metric_name  TEXT        NOT NULL DEFAULT '',
  value        NUMERIC     NOT NULL,
  unit         TEXT        NOT NULL DEFAULT '',
  period_start DATE        NOT NULL,
  period_end   DATE        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_kpi_period CHECK (period_end >= period_start)
);

CREATE TRIGGER trg_kpi_entries_updated_at
  BEFORE UPDATE ON kpi_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_kpi_entries_user_period
  ON kpi_entries (user_id, period_start, period_end);

-- ---------------------------------------------------------------------------
-- 4. routine_checks
--    일별 루틴 체크 (check_date 기준, week_start 는 해당 주 월요일)
-- ---------------------------------------------------------------------------
CREATE TABLE routine_checks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  routine_name  TEXT        NOT NULL DEFAULT '',
  check_date    DATE        NOT NULL,
  week_start    DATE        NOT NULL
                            CHECK (EXTRACT(DOW FROM week_start) = 1),
  is_completed  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_routine_checks_user_name_date
    UNIQUE (user_id, routine_name, check_date)
);

CREATE TRIGGER trg_routine_checks_updated_at
  BEFORE UPDATE ON routine_checks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_routine_checks_user_week
  ON routine_checks (user_id, week_start);

CREATE INDEX idx_routine_checks_date
  ON routine_checks (check_date);

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 5-1. profiles RLS
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 또는 admin
CREATE POLICY profiles_select
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- INSERT: 본인만 (id = auth.uid())
CREATE POLICY profiles_insert
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- UPDATE: 본인 또는 admin
CREATE POLICY profiles_update
  ON profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 5-2. weekly_reports RLS
-- ---------------------------------------------------------------------------
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 또는 admin
CREATE POLICY weekly_reports_select
  ON weekly_reports FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

-- INSERT: 본인만
CREATE POLICY weekly_reports_insert
  ON weekly_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE: 본인만
CREATE POLICY weekly_reports_update
  ON weekly_reports FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: 본인만
CREATE POLICY weekly_reports_delete
  ON weekly_reports FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5-3. kpi_entries RLS
-- ---------------------------------------------------------------------------
ALTER TABLE kpi_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY kpi_entries_select
  ON kpi_entries FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

CREATE POLICY kpi_entries_insert
  ON kpi_entries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY kpi_entries_update
  ON kpi_entries FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY kpi_entries_delete
  ON kpi_entries FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5-4. routine_checks RLS
-- ---------------------------------------------------------------------------
ALTER TABLE routine_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY routine_checks_select
  ON routine_checks FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.deleted_at IS NULL
    )
  );

CREATE POLICY routine_checks_insert
  ON routine_checks FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY routine_checks_update
  ON routine_checks FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY routine_checks_delete
  ON routine_checks FOR DELETE
  USING (user_id = auth.uid());
