-- 052_gpu_integrity.sql — L3 DB 불변식 (docs 05 §6, ADD-only/롤백 가능)
-- 정합성을 앱 규율이 아니라 DB 구조로 강제. 대량·우회 입력도 막는다.
--
-- 적용 안전성 (사전 점검 완료):
--   · gpu_count < 1 위반 0건 → CHECK 안전
--   · per_gpu_usd 생성컬럼: gpu_count NOT NULL DEFAULT 1, <1 없음 → division 안전
--   · confirmed NULL supplier 10건 / NULL product 5건 존재 → CHECK 불가.
--     대신 트리거로 "신규 write"만 검증(기존 행 불변) → ADD-only 보존.

BEGIN;

-- 1) per_gpu_usd 생성컬럼 — 단위 표준 보증 (읽기측 재계산 불일치 차단)
--    unit_price_usd = 구성(gpu_count) 총액 → per_gpu = 총액 / 장수
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS per_gpu_usd numeric
  GENERATED ALWAYS AS (unit_price_usd / NULLIF(gpu_count, 0)) STORED;

-- 2) gpu_count >= 1 CHECK (구성 장수는 최소 1)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supply_quotes_gpu_count_min'
  ) THEN
    ALTER TABLE supply_quotes
      ADD CONSTRAINT supply_quotes_gpu_count_min CHECK (gpu_count >= 1);
  END IF;
END $$;

-- 3) 트리거 — confirmed 견적은 supplier_id·product_id 필수 (신규 write만)
--    기존 NULL 행은 건드리지 않음(상태가 confirmed로 새로 쓰일 때만 검증).
CREATE OR REPLACE FUNCTION enforce_confirmed_quote_required()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NEW.supplier_id IS NULL THEN
      RAISE EXCEPTION '확정 견적은 공급사(supplier_id)가 필수입니다';
    END IF;
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION '확정 견적은 상품(product_id)이 필수입니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_confirmed_quote ON supply_quotes;
CREATE TRIGGER trg_enforce_confirmed_quote
  BEFORE INSERT OR UPDATE ON supply_quotes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_confirmed_quote_required();

COMMIT;

-- 롤백 (필요 시):
--   DROP TRIGGER IF EXISTS trg_enforce_confirmed_quote ON supply_quotes;
--   DROP FUNCTION IF EXISTS enforce_confirmed_quote_required();
--   ALTER TABLE supply_quotes DROP CONSTRAINT IF EXISTS supply_quotes_gpu_count_min;
--   ALTER TABLE supply_quotes DROP COLUMN IF EXISTS per_gpu_usd;
