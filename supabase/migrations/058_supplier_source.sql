-- 058: 공급사 입력 출처 구분 (통합입력 자동생성 vs 수동 추가)
-- 통합입력(/intake 견적)에서 자동 생성된 공급사 vs '공급사 추가' 버튼 수동 입력을 구분.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- 기존 데이터 출처 추정: 견적이 연결돼 있으면 통합입력 유래로 간주(대부분 통합입력 적재)
UPDATE suppliers s SET source = 'integrated'
WHERE source = 'manual'
  AND EXISTS (SELECT 1 FROM supply_quotes q WHERE q.supplier_id = s.id);

-- 값 제약
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_source') THEN
    ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_source CHECK (source IN ('integrated', 'manual', 'migration'));
  END IF;
END $$;
