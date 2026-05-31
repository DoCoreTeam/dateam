-- =============================================================================
-- 036_partner_tiers.sql
-- 파트너 등급 및 할인율 관리
-- RLS: 팀원 전체 읽기, admin만 쓰기
-- =============================================================================

CREATE TABLE partner_tiers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  name          TEXT        NOT NULL UNIQUE,
  discount_rate NUMERIC(5,2) NOT NULL DEFAULT 0
                            CHECK (discount_rate >= 0 AND discount_rate <= 100),
  description   TEXT
);

CREATE TRIGGER trg_partner_tiers_updated_at
  BEFORE UPDATE ON partner_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE partner_tiers ENABLE ROW LEVEL SECURITY;

-- 팀원 전체 읽기
CREATE POLICY "partner_tiers_select_all" ON partner_tiers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

-- admin만 생성
CREATE POLICY "partner_tiers_insert_admin" ON partner_tiers
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );

-- admin만 수정
CREATE POLICY "partner_tiers_update_admin" ON partner_tiers
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );

-- admin만 삭제
CREATE POLICY "partner_tiers_delete_admin" ON partner_tiers
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
