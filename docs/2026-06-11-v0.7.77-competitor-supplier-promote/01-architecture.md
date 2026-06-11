# 01 아키텍처 (v0.7.77)

## 데이터
- `competitors.supplier_id` (FK→suppliers, 083) — 이중역할 연결고리(유지).
- `suppliers.source` CHECK 확장: `('integrated','manual','migration','competitor_link')` — 마이그084. 'competitor_link' = 경쟁사 지정으로 자동생성된 공급사.
- 겸업 판정 SSOT = "competitors.supplier_id = suppliers.id 역방향 조회". source 마커는 보조 provenance.

## 흐름: 경쟁사 → 공급사 1클릭 지정
```
[시장비교] "공급사로 지정" 클릭
  → POST /api/pricing/gpu/market/competitors/[id]/promote-supplier (admin)
      1. competitor 조회. 이미 supplier_id 있으면 멱등 200(기존 반환)
      2. suppliers에서 동명(name) 조회 → 있으면 그 id 재사용(중복 금지)
      3. 없으면 supplier insert(name·color·website·logo승계, source='competitor_link')
         + ensureSupplierAccount (accounts is_supplier 링크 — 기존 공용)
      4. competitors.supplier_id = supplierId
      5. recordGpuAudit('market_price_updated', op='competitor_promoted_supplier')
      6. revalidateGpu()
  → 공급사 메뉴에 자동 등장(suppliers 목록에 포함됨) + 겸업 뱃지
```

## 통합 노출
- `GET /api/pricing/gpu/suppliers`: 기존 suppliers 목록 + 역방향 competitors 조회로 `is_competitor`·`linked_competitor_name` 부여. 자동생성 supplier가 목록에 이미 포함 → 통합 노출 자동 달성. 뱃지로 겸업 구분.

## 원가→판매가 (기존 재사용)
- 지정 후 시장비교에서 그 경쟁가 "원가 인입"(v0.7.76 승인형 ingest-cost) → supply_quotes(cost) → buildCatalog가 +마진 판매가 자동형성.

## 소싱 기밀
- 공급관계는 competitors.supplier_id(내부) + suppliers.source(내부). 공개 API(v1/suppliers·market)는 해당 컬럼 미select → 기본 비노출.
