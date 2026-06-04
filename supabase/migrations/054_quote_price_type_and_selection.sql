-- 054: 공급견적 가격유형(price_type) 분리 + 기준 공급가 채택(is_selected)
--
-- 배경:
--   migration 027이 gcube.ai/ko/price(gcube 자사 공시 '판매가')를 supply_quotes(공급원가)로
--   적재 → 타사 매입원가(Equinix 등)와 동일선상 비교되어 최저가/판매가 계산이 왜곡됨.
--   (gcube 판매가 × (1+마진) = 이중 마진)
--
-- 해결:
--   1) price_type 컬럼: 'cost'(진짜 매입원가) | 'list'(자사·경쟁 공시 판매가, 참고용)
--      → 공급원가 계산은 'cost'만 사용. gcube 104건은 'list'로 마킹(참고선).
--   2) is_selected 컬럼: 상품별로 "고객 가격표 기준"으로 채택한 견적 1건 지정.
--      → 채택 있으면 그 견적이 effective 기준, 없으면 기존 자동 최저가(회귀 없음).
--      → 한 상품당 채택 최대 1건 (partial unique index).

ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'cost',
  ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false;

-- price_type 값 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_supply_quotes_price_type'
  ) THEN
    ALTER TABLE supply_quotes
      ADD CONSTRAINT chk_supply_quotes_price_type CHECK (price_type IN ('cost', 'list'));
  END IF;
END $$;

-- gcube 견적 = 자사 공시 판매가 → 'list'로 마킹 (이름 기준, id 하드코딩 회피)
UPDATE supply_quotes q
SET price_type = 'list'
FROM suppliers s
WHERE q.supplier_id = s.id
  AND s.name = 'gcube';

-- 한 상품당 채택(is_selected=true)은 최대 1건 보장
CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_quotes_selected_per_product
  ON supply_quotes (product_id)
  WHERE is_selected = true;

-- 조회 성능: cost 견적 필터 인덱스
CREATE INDEX IF NOT EXISTS idx_supply_quotes_price_type
  ON supply_quotes (price_type);
