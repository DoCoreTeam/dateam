-- =============================================================================
-- 009_lead_management.sql
-- gcube CRM: accounts, contacts, deals, deal_activities, lead_intakes
-- RLS: 모든 팀원 읽기, 본인 작성 수정/삭제
-- =============================================================================

-- ---------------------------------------------------------------------------
-- accounts (거래처)
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  name        TEXT        NOT NULL,
  industry    TEXT,
  segment     TEXT        CHECK (segment IN ('엔터프라이즈', 'SMB', '공공', '스타트업', NULL)),
  size        TEXT,
  region      TEXT,
  website     TEXT,
  phone       TEXT,
  address     TEXT,
  description TEXT,
  fit_score   INTEGER     CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  source      TEXT
);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_name ON accounts(name);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- 팀원 전체 읽기 (팀 단위 영업)
CREATE POLICY "accounts_select_all" ON accounts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "accounts_insert_own" ON accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "accounts_update_own" ON accounts
  FOR UPDATE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

CREATE POLICY "accounts_delete_own" ON accounts
  FOR DELETE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

-- ---------------------------------------------------------------------------
-- contacts (담당자)
-- ---------------------------------------------------------------------------
CREATE TABLE contacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  name         TEXT        NOT NULL,
  title        TEXT,
  department   TEXT,
  email        TEXT,
  phone        TEXT,
  mobile       TEXT,
  linkedin     TEXT,
  notes        TEXT
);

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_account_id ON contacts(account_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select_all" ON contacts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "contacts_insert_own" ON contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contacts_update_own" ON contacts
  FOR UPDATE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

CREATE POLICY "contacts_delete_own" ON contacts
  FOR DELETE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

-- ---------------------------------------------------------------------------
-- deals (영업기회)
-- ---------------------------------------------------------------------------
CREATE TABLE deals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  title            TEXT        NOT NULL,
  stage            TEXT        NOT NULL DEFAULT '신규'
                               CHECK (stage IN ('신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패')),
  value            NUMERIC,
  probability      INTEGER     DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  close_date       DATE,
  description      TEXT,
  next_action      TEXT,
  next_action_date DATE,
  tags             TEXT[]      NOT NULL DEFAULT '{}'
);

CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_deals_user_id ON deals(user_id);
CREATE INDEX idx_deals_account_id ON deals(account_id);
CREATE INDEX idx_deals_stage ON deals(stage);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals_select_all" ON deals
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "deals_insert_own" ON deals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "deals_update_own" ON deals
  FOR UPDATE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

CREATE POLICY "deals_delete_own" ON deals
  FOR DELETE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

-- ---------------------------------------------------------------------------
-- deal_activities (영업기회 활동 로그)
-- ---------------------------------------------------------------------------
CREATE TABLE deal_activities (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT        NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'ai')),
  content     TEXT        NOT NULL,
  ai_parsed   BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX idx_deal_activities_deal_id ON deal_activities(deal_id);

ALTER TABLE deal_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_activities_select_all" ON deal_activities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "deal_activities_insert_own" ON deal_activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "deal_activities_delete_own" ON deal_activities
  FOR DELETE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

-- ---------------------------------------------------------------------------
-- lead_intakes (리드 인테이크)
-- ---------------------------------------------------------------------------
CREATE TABLE lead_intakes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source             TEXT        NOT NULL CHECK (source IN ('prompt', 'business_card', 'file', 'manual')),
  raw_input          TEXT,
  file_url           TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  parsed_data        JSONB,
  linked_account_id  UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  linked_contact_id  UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  linked_deal_id     UUID        REFERENCES deals(id) ON DELETE SET NULL,
  fit_score          INTEGER     CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  duplicate_of       UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  notes              TEXT
);

CREATE TRIGGER trg_lead_intakes_updated_at
  BEFORE UPDATE ON lead_intakes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lead_intakes_user_id ON lead_intakes(user_id);
CREATE INDEX idx_lead_intakes_status ON lead_intakes(status);

ALTER TABLE lead_intakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_intakes_select_all" ON lead_intakes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "lead_intakes_insert_own" ON lead_intakes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lead_intakes_update_own" ON lead_intakes
  FOR UPDATE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));

CREATE POLICY "lead_intakes_delete_own" ON lead_intakes
  FOR DELETE USING (auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL));
