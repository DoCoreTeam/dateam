# v0.7.80 — 경쟁사→공급사 승격 시 정보·견적 완전 등록 + "기존 공급사 연결" 제거

## 작업
사용자 지적: "기존 공급사 연결" 드롭다운은 안 맞고 불필요. 경쟁사를 공급사로 지정하면 관련 견적·정보가 다 등록돼야 하는데 빈 껍데기였음(Image #18 Elice 견적0·정보0).

## 변경
1. **"기존 공급사 연결" 드롭다운 완전 제거** — SupplierLinkControl은 "공급사로 지정" 1버튼만. suppliers prop·supplierOptions 배선·SupplierOption 타입 제거(死코드 정리).
2. **promote-supplier 완전 등록**:
   - 정보 풀복사: country=region·website·color·description(자동 생성문) — 빈 필드만 백필(이미 연결/재사용 시에도 보강, 수동 입력값 보존).
   - **시장가 일괄 cost 인입**: 그 경쟁사의 활성 매핑별 최신 market_price를 supply_quotes(price_type='cost', source_format='market_link', source_market_price_id/source_competitor_id, status='confirmed') 스냅샷으로 일괄 생성. 중복 가드(source_market_price_id). → 공급사 카드에 견적 채워지고 buildCatalog 최저공급가/판매가 반영.
   - 사용자 확정: 승격=일괄 등록(원가 반영). 지속 자동상승 방지(스냅샷) 가드레일 유지.

## 파일
- apps/web/app/api/pricing/gpu/market/competitors/[id]/promote-supplier/route.ts (bulkIngestMarketCost + 정보 백필)
- apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx (드롭다운 제거 + 死코드 정리)

## 검증 (Playwright, 원복)
- Elice Cloud 승격 → cost 견적 4건 인입 + country='global' + 설명 자동 + 멱등 재호출 0건. 공급사 카드 정보·견적 채워짐 확인 후 전량 원복(suppliers 7).
- tsc0 / design:check / test(70) / lint(경고만) 통과. DB/마이그 변경 없음(기존 컬럼 재사용).
