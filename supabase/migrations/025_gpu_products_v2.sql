-- 025_gpu_products_v2.sql
-- gpu_products: add hardware spec columns + replace 14 seed rows with 121 gcube catalog rows
-- suppliers: clear all seed data (suppliers created dynamically via quote registration)

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Add spec columns to gpu_products
-- ─────────────────────────────────────────────
ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS gpu_count  int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vcpu       int  NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS ram_gb     int  NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS storage_gb int  NOT NULL DEFAULT 512,
  ADD COLUMN IF NOT EXISTS series     text;

-- ─────────────────────────────────────────────
-- 2. Replace unique constraint
-- ─────────────────────────────────────────────
ALTER TABLE gpu_products DROP CONSTRAINT IF EXISTS unique_product;
ALTER TABLE gpu_products DROP CONSTRAINT IF EXISTS unique_product_v2;
ALTER TABLE gpu_products
  ADD CONSTRAINT unique_product_v2 UNIQUE (model_name, memory, gpu_count, vcpu, tier);

-- ─────────────────────────────────────────────
-- 3. Clear dependent data then seed tables
-- ─────────────────────────────────────────────
TRUNCATE supply_quotes, direct_prices, gpu_audit_logs RESTART IDENTITY CASCADE;
DELETE FROM gpu_products;
DELETE FROM suppliers;

-- ─────────────────────────────────────────────
-- 4. Insert 121 gcube catalog products
-- ─────────────────────────────────────────────

-- ── RTX 5000 Series — TIER 2 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 5090',    '32GB', 2, 'quote', 1, 12, 63,  937,  'RTX 5000'),
  ('RTX 5080',    '16GB', 2, 'quote', 1, 24, 31,  937,  'RTX 5000'),
  ('RTX 5070',    '12GB', 2, 'quote', 1, 12, 63,  930,  'RTX 5000'),
  ('RTX 5060',    '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 5000');

-- ── RTX 5000 Series — TIER 3 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 5090',    '32GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5080',    '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5070 Ti', '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5070',    '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5060 Ti', '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5060',    '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 5000'),
  ('RTX 5060',    '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 5000');

-- ── RTX 4000 Series — TIER 2 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 4090',         '24GB', 2, 'quote', 1, 12, 62, 937,  'RTX 4000'),
  ('RTX 4080 Super',   '16GB', 2, 'quote', 1, 24, 63, 939,  'RTX 4000'),
  ('RTX 4080',         '16GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4070 Ti Super','16GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4070 Ti',      '12GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4070 Super',   '12GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4070',         '12GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4060 Ti',      '16GB', 2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4060 Ti',      '8GB',  2, 'quote', 1, 12, 16, 512,  'RTX 4000'),
  ('RTX 4060',         '8GB',  2, 'quote', 1, 12, 16, 512,  'RTX 4000');

-- ── RTX 4000 Series — TIER 3 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 4090',         '24GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4080 Super',   '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4080',         '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4070 Ti Super','16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4070 Ti',      '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4070 Super',   '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4070',         '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4060 Ti',      '16GB', 3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4060 Ti',      '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 4000'),
  ('RTX 4060',         '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 4000');

-- ── RTX 3000 Series — TIER 2 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 3090 Ti', '24GB', 2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3090',    '24GB', 2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3080 Ti', '12GB', 2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3080',    '12GB', 2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3080',    '10GB', 2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3070 Ti', '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3070',    '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3060 Ti', '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3060',    '12GB', 2, 'quote', 1, 12, 31,  4096, 'RTX 3000'),
  ('RTX 3060',    '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 3000'),
  ('RTX 3050',    '8GB',  2, 'quote', 1, 12, 16,  512,  'RTX 3000');

-- ── RTX 3000 Series — TIER 3 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 3090 Ti', '24GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3090',    '24GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3080 Ti', '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3080',    '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3080',    '10GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3070 Ti', '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3070',    '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3060 Ti', '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3060',    '12GB', 3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3060',    '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 3000'),
  ('RTX 3050',    '8GB',  3, 'quote', 1, 12, 16, 50,  'RTX 3000');

-- ── RTX 2000 Series — TIER 2 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 2080 Ti',    '11GB', 2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2080 Super', '8GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2080',       '8GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2070 Super', '8GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2070',       '8GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2060 Super', '8GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2060',       '12GB', 2, 'quote', 1, 12, 16, 512, 'RTX 2000'),
  ('RTX 2060',       '6GB',  2, 'quote', 1, 12, 16, 512, 'RTX 2000');

-- ── RTX 2000 Series — TIER 3 ──────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 2080 Ti',    '11GB', 3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2080 Super', '8GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2080',       '8GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2070 Super', '8GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2070',       '8GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2060 Super', '8GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2060',       '12GB', 3, 'quote', 1, 12, 16, 50, 'RTX 2000'),
  ('RTX 2060',       '6GB',  3, 'quote', 1, 12, 16, 50, 'RTX 2000');

-- ── A100 Series — TIER 1 ──────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('A100', '40GB',  1, 'quote', 1, 30,  225,  512,   'A100'),
  ('A100', '80GB',  1, 'quote', 2, 60,  450,  1024,  'A100'),
  ('A100', '160GB', 1, 'quote', 4, 120, 900,  1024,  'A100'),
  ('A100', '320GB', 1, 'quote', 8, 124, 1800, 6144,  'A100'),
  ('A100', '640GB', 1, 'quote', 8, 240, 1800, 20480, 'A100');

-- ── H100 Series — TIER 1 ──────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('H100', '80GB',  1, 'quote', 1, 26,  225,  3072,  'H100'),
  ('H100', '160GB', 1, 'quote', 2, 52,  450,  6144,  'H100'),
  ('H100', '320GB', 1, 'quote', 4, 104, 900,  11264, 'H100'),
  ('H100', '640GB', 1, 'quote', 8, 208, 1800, 23552, 'H100');

-- ── B200 Series — TIER 1 ──────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('B200', '180GB',  1, 'quote', 1, 26,  360,  3072,  'B200'),
  ('B200', '360GB',  1, 'quote', 2, 52,  720,  6144,  'B200'),
  ('B200', '720GB',  1, 'quote', 4, 104, 1440, 11264, 'B200'),
  ('B200', '1440GB', 1, 'quote', 8, 208, 2900, 23552, 'B200');

-- ── V100 Series — TIER 1 ──────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('V100', '32GB',  1, 'quote', 1, 8,  90,  200, 'V100'),
  ('V100', '64GB',  1, 'quote', 2, 16, 180, 200, 'V100'),
  ('V100', '128GB', 1, 'quote', 4, 32, 360, 200, 'V100');

-- ── T4 Series — TIER 1 (multiple vCPU configs) ─
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('T4', '16GB', 1, 'quote', 1, 4,  20,  200, 'T4'),
  ('T4', '16GB', 1, 'quote', 1, 8,  40,  200, 'T4'),
  ('T4', '16GB', 1, 'quote', 1, 16, 80,  200, 'T4'),
  ('T4', '32GB', 1, 'quote', 2, 8,  40,  200, 'T4'),
  ('T4', '32GB', 1, 'quote', 2, 16, 80,  200, 'T4'),
  ('T4', '32GB', 1, 'quote', 2, 32, 160, 200, 'T4');

-- ── RTX A Series — TIER 2 ─────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX A6000', '48GB', 2, 'quote', 1, 12, 16, 512, 'RTX A Series'),
  ('RTX A5500', '24GB', 2, 'quote', 1, 12, 16, 512, 'RTX A Series'),
  ('RTX A5000', '24GB', 2, 'quote', 1, 12, 16, 512, 'RTX A Series'),
  ('RTX A4500', '20GB', 2, 'quote', 1, 12, 16, 512, 'RTX A Series'),
  ('RTX A4000', '16GB', 2, 'quote', 1, 12, 16, 512, 'RTX A Series'),
  ('RTX A2000', '6GB',  2, 'quote', 1, 12, 16, 512, 'RTX A Series');

-- ── RTX A Series — TIER 3 ─────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX A6000', '48GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series'),
  ('RTX A5500', '24GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series'),
  ('RTX A5000', '24GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series'),
  ('RTX A4500', '20GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series'),
  ('RTX A4000', '16GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series'),
  ('RTX A2000', '12GB', 3, 'quote', 1, 12, 16, 50, 'RTX A Series');

-- ── RTX Ada Series — TIER 2 ───────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 6000 Ada', '48GB', 2, 'quote', 1, 12, 16, 512, 'RTX Ada'),
  ('RTX 5000 Ada', '32GB', 2, 'quote', 1, 12, 16, 512, 'RTX Ada'),
  ('RTX 4500 Ada', '24GB', 2, 'quote', 1, 12, 16, 512, 'RTX Ada');

-- ── RTX Ada Series — TIER 3 ───────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX 5000 Ada', '20GB', 3, 'quote', 1, 12, 16, 50, 'RTX Ada'),
  ('RTX 4500 Ada', '20GB', 3, 'quote', 1, 12, 16, 50, 'RTX Ada'),
  ('RTX 4000 Ada', '20GB', 3, 'quote', 1, 12, 16, 50, 'RTX Ada');

-- ── A40 — TIER 2 ──────────────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('A40', '48GB', 2, 'quote', 1, 12, 16, 512, 'A40');

-- ── Tesla Series — TIER 2 ─────────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('Tesla K80',  '24GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla K40',  '12GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla M60',  '16GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla M40',  '12GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla M10',  '32GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla P100', '16GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla P100', '12GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla P40',  '24GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla P6',   '16GB', 2, 'quote', 1, 12, 16, 512, 'Tesla'),
  ('Tesla P4',   '8GB',  2, 'quote', 1, 12, 16, 512, 'Tesla');

-- ── RTX PRO Series — TIER 3 ───────────────────
INSERT INTO gpu_products (model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series) VALUES
  ('RTX PRO 2000', '16GB', 3, 'quote', 1, 12, 16, 70, 'RTX PRO');

COMMIT;
