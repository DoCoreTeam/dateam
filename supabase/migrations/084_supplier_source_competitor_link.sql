-- 084: suppliers.source CHECK 확장 — 'competitor_link' 추가
-- 경쟁사를 "공급사로 지정" 시 자동생성되는 공급사의 출처 마커.
-- 058에서 chk_suppliers_source = ('integrated','manual','migration'). 여기에 'competitor_link' 추가.
-- 멱등: 제약을 DROP 후 재생성. 기존 데이터 영향 없음(새 값만 허용 추가).

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_suppliers_source;
ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_source
  CHECK (source IN ('integrated', 'manual', 'migration', 'competitor_link'));

COMMENT ON COLUMN suppliers.source IS
  'integrated: 통합입력 자동생성 / manual: 수동 추가 / migration: 마이그 적재 / competitor_link: 시장비교 경쟁사를 공급사로 지정 시 자동생성';
