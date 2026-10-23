-- 317: 가격 기준 버전, 할인 겹침 방식, 할인 후 합계 절사, 견적 줄의 기준 버전 (P0157 I01)
--
-- REQ-012 새 가격표를 같은 제품의 새 버전으로 올린다 → revision, effectiveFrom
-- REQ-009 기관 할인과 규모 조정 할인이 겹칠 때 → discountStackMode (MAX 큰 것 하나 · MULTIPLY 곱해서 · ADD 더해서)
-- REQ-010 「할인 적용 후 만원 미만 절사」 → supplyRoundingUnit (제품의 기본값, 견적은 그 값을 받아 저장해 다시 계산해도 같게)
-- REQ-023 견적 줄이 어느 기준 버전에서 왔나 → priceProductId, priceProductRevision
--
-- 기본값은 지금 동작과 같다: revision 1, MAX(마이그 233 의 「적용되는 할인율은 하나」), 절사 0(안 함), 기준 없음.
-- 보안 (LOOP.md 7절): ① 새 표 없음, 있는 표에 칼럼만 ② 창구 없음 ③ 값은 CHECK 로 닫음, RLS 와 GRANT 그대로
-- 되돌리기: ALTER TABLE ... DROP COLUMN 일곱 개 (값을 쓰는 코드를 먼저 되돌린다)

ALTER TABLE "crm_price_product"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "effectiveFrom" DATE,
  ADD COLUMN IF NOT EXISTS "discountStackMode" TEXT NOT NULL DEFAULT 'MAX',
  ADD COLUMN IF NOT EXISTS "supplyRoundingUnit" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "crm_price_product" DROP CONSTRAINT IF EXISTS "chk_price_product_stack_mode";
ALTER TABLE "crm_price_product" ADD CONSTRAINT "chk_price_product_stack_mode"
  CHECK ("discountStackMode" IN ('MAX', 'MULTIPLY', 'ADD'));
ALTER TABLE "crm_price_product" DROP CONSTRAINT IF EXISTS "chk_price_product_supply_rounding";
ALTER TABLE "crm_price_product" ADD CONSTRAINT "chk_price_product_supply_rounding"
  CHECK ("supplyRoundingUnit" IN (0, 1000, 10000, 100000, 1000000) AND "revision" >= 1);

ALTER TABLE "crm_quote"
  ADD COLUMN IF NOT EXISTS "supplyRoundingUnit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "crm_quote" DROP CONSTRAINT IF EXISTS "chk_quote_supply_rounding";
ALTER TABLE "crm_quote" ADD CONSTRAINT "chk_quote_supply_rounding"
  CHECK ("supplyRoundingUnit" IN (0, 1000, 10000, 100000, 1000000));

ALTER TABLE "crm_quote_line"
  ADD COLUMN IF NOT EXISTS "priceProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "priceProductRevision" INTEGER;
