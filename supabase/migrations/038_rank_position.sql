-- profiles에 직급/직책 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rank TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position TEXT;

-- 직급 마스터 테이블
CREATE TABLE IF NOT EXISTS org_ranks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO org_ranks (name, display_order) VALUES
  ('회장', 10), ('부회장', 20), ('사장', 30), ('부사장', 40),
  ('전무', 50), ('상무', 60), ('이사', 70), ('부장', 80),
  ('차장', 90), ('과장', 100), ('대리', 110), ('주임', 115),
  ('사원', 120), ('책임', 130), ('선임', 140), ('연구원', 150)
ON CONFLICT (name) DO NOTHING;

-- 직책 마스터 테이블
CREATE TABLE IF NOT EXISTS org_positions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO org_positions (name, display_order) VALUES
  ('대표이사', 10), ('본부장', 20), ('부본부장', 30),
  ('실장', 40), ('팀장', 50), ('파트장', 60), ('부팀장', 70)
ON CONFLICT (name) DO NOTHING;

-- RLS
ALTER TABLE org_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_read_ranks" ON org_ranks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_manage_ranks" ON org_ranks
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  ));

CREATE POLICY "team_read_positions" ON org_positions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_manage_positions" ON org_positions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  ));
