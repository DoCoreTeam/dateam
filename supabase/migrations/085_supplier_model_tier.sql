-- 085: 공급사+모델별 Tier override (라벨/분류 전용 — 가격 계산 무관)
-- 같은 H100이라도 A공급사는 Tier1, B공급사는 Tier2로 분류·표시할 수 있게.
-- gpu_products.tier(모델 단위)는 그대로 두고, 공급사별 표시 tier만 override.
-- 가격(buildCatalog/마진/판매가)에는 영향 없음 — 분류·필터·뱃지·그룹 표시에만 사용.

CREATE TABLE IF NOT EXISTS supplier_model_tier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  tier int NOT NULL CHECK (tier IN (1, 2, 3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_model_tier_supplier
  ON supplier_model_tier (supplier_id);

COMMENT ON TABLE supplier_model_tier IS
  '공급사+모델별 Tier override (라벨/분류 전용). gpu_products.tier를 공급사 시점에서 덮어쓴 표시값 — 가격 계산 무관.';

-- RLS — 기존 gpu 테이블 패턴(all read / service_role write) 동일
ALTER TABLE supplier_model_tier ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "all: read supplier_model_tier" ON supplier_model_tier;
CREATE POLICY "all: read supplier_model_tier" ON supplier_model_tier FOR SELECT USING (true);
DROP POLICY IF EXISTS "service: write supplier_model_tier" ON supplier_model_tier;
CREATE POLICY "service: write supplier_model_tier" ON supplier_model_tier FOR ALL USING (auth.role() = 'service_role');
