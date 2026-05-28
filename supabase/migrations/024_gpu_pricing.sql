-- ============================================================
-- 024: gcube GPU 가격관리 모듈
-- suppliers · gpu_products · supply_quotes · direct_prices
-- fx_rates · pricing_settings · audit_logs · v_lowest_quotes
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. suppliers — 공급사
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  location   text,
  contact    text,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read suppliers" ON suppliers FOR SELECT USING (true);
CREATE POLICY "service: write suppliers" ON suppliers FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 2. gpu_products — 상품 (모델 × tier)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gpu_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name   text NOT NULL,
  memory       text NOT NULL,
  tier         int  NOT NULL CHECK (tier IN (1, 2, 3)),
  pricing_mode text NOT NULL CHECK (pricing_mode IN ('quote', 'direct')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_product UNIQUE (model_name, memory, tier)
);

ALTER TABLE gpu_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read gpu_products" ON gpu_products FOR SELECT USING (true);
CREATE POLICY "service: write gpu_products" ON gpu_products FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 3. supply_quotes — 공급견적 (Tier 1·2)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_quotes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               uuid REFERENCES gpu_products(id) ON DELETE CASCADE,
  supplier_id              uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  unit_price_usd           numeric NOT NULL,
  original_currency        text,
  original_price           numeric,
  original_unit            text,
  term                     text,
  min_qty                  text,
  valid_until              date,
  source_format            text CHECK (source_format IN ('mail','pdf','img','msg','own','text')),
  evidence_drive_file_id   text,
  evidence_hash            text,
  ai_confidence            int CHECK (ai_confidence BETWEEN 0 AND 100),
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','confirmed','expired','rejected')),
  received_at              timestamptz,
  registered_by            text,
  confirmed_by             text,
  confirmed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supply_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read supply_quotes" ON supply_quotes FOR SELECT USING (true);
CREATE POLICY "service: write supply_quotes" ON supply_quotes FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_supply_quotes_product ON supply_quotes(product_id, status, unit_price_usd);
CREATE INDEX IF NOT EXISTS idx_supply_quotes_supplier ON supply_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supply_quotes_valid ON supply_quotes(valid_until) WHERE status = 'confirmed';

-- ────────────────────────────────────────────────────────────
-- 4. direct_prices — Tier 3 직접 판매가
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid REFERENCES gpu_products(id) ON DELETE CASCADE,
  sell_price_krw  numeric NOT NULL,
  note            text,
  set_by          text,
  set_at          timestamptz NOT NULL DEFAULT now(),
  is_current      boolean NOT NULL DEFAULT true
);

ALTER TABLE direct_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read direct_prices" ON direct_prices FOR SELECT USING (true);
CREATE POLICY "service: write direct_prices" ON direct_prices FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_direct_prices_product ON direct_prices(product_id, is_current);

-- ────────────────────────────────────────────────────────────
-- 5. fx_rates — 일별 환율 (한국수출입은행)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date  date PRIMARY KEY,
  usd_krw    numeric NOT NULL,
  source     text NOT NULL DEFAULT 'koreaexim',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read fx_rates" ON fx_rates FOR SELECT USING (true);
CREATE POLICY "service: write fx_rates" ON fx_rates FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 6. pricing_settings — 전역 마진 설정 (단일 행)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_settings (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  margin_pct  numeric NOT NULL DEFAULT 18,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read pricing_settings" ON pricing_settings FOR SELECT USING (true);
CREATE POLICY "service: write pricing_settings" ON pricing_settings FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 7. audit_logs — 감사 로그
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gpu_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts           timestamptz NOT NULL DEFAULT now(),
  actor        text,
  action_type  text NOT NULL CHECK (action_type IN (
    'quote_registered','quote_confirmed','lowest_changed',
    'expired','direct_set','margin_changed','rejected'
  )),
  product_id   uuid REFERENCES gpu_products(id) ON DELETE SET NULL,
  detail       jsonb,
  evidence_ref text
);

ALTER TABLE gpu_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read gpu_audit_logs" ON gpu_audit_logs FOR SELECT USING (true);
CREATE POLICY "service: write gpu_audit_logs" ON gpu_audit_logs FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON gpu_audit_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_product ON gpu_audit_logs(product_id, ts DESC);

-- ────────────────────────────────────────────────────────────
-- 8. 뷰: v_lowest_quotes — (모델×tier)별 최저가 확정 견적
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_lowest_quotes AS
SELECT DISTINCT ON (product_id)
  product_id,
  id AS quote_id,
  supplier_id,
  unit_price_usd,
  valid_until
FROM supply_quotes
WHERE status = 'confirmed'
  AND valid_until >= current_date
ORDER BY product_id, unit_price_usd ASC;

-- ────────────────────────────────────────────────────────────
-- 9. 시드 데이터 — pricing_settings 초기값
-- ────────────────────────────────────────────────────────────
INSERT INTO pricing_settings (id, margin_pct)
VALUES (1, 18)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 10. 시드 데이터 — suppliers
-- ────────────────────────────────────────────────────────────
INSERT INTO suppliers (name, location, color) VALUES
  ('GMI Cloud',      '🇺🇸 미국',     '#2563eb'),
  ('FPT Cloud',      '🇻🇳 베트남',   '#e0405a'),
  ('AL FARDAN',      '🇦🇪 아부다비', '#15a35a'),
  ('메가존클라우드',  '🇰🇷 한국',     '#7c3aed'),
  ('자체 IDC',       '🇰🇷 한국',     '#13151c'),
  ('Vast.ai',        '🇺🇸 미국',     '#d97706')
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 11. 시드 데이터 — gpu_products (14개 상품)
-- ────────────────────────────────────────────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode) VALUES
  -- Tier 1: 전용 고성능
  ('B200',       '192GB', 1, 'quote'),
  ('H200 SXM',   '141GB', 1, 'quote'),
  ('H100 SXM',   '80GB',  1, 'quote'),
  ('A100 SXM',   '80GB',  1, 'quote'),
  ('V100',       '32GB',  1, 'quote'),
  ('T4',         '16GB',  1, 'quote'),
  -- Tier 2: 점유형
  ('RTX 5090',   '32GB',  2, 'quote'),
  ('RTX 4090',   '24GB',  2, 'quote'),
  ('RTX 4080',   '16GB',  2, 'quote'),
  ('A40',        '48GB',  2, 'quote'),
  -- Tier 3: 간헐 공급
  ('RTX 5090',   '32GB',  3, 'direct'),
  ('RTX 4090',   '24GB',  3, 'direct'),
  ('RTX 3090',   '24GB',  3, 'direct'),
  ('RTX 4070 Ti','12GB',  3, 'direct')
ON CONFLICT (model_name, memory, tier) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 12. 시드 데이터 — 샘플 환율
-- ────────────────────────────────────────────────────────────
INSERT INTO fx_rates (rate_date, usd_krw, source) VALUES
  ('2026-05-28', 1498.20, 'koreaexim')
ON CONFLICT (rate_date) DO NOTHING;
