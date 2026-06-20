# Summary — v0.7.220

## 작업
GPU pricing 영속캐시 stale 재검증을 **GpuPricingClient 전 탭으로 확대 + 단일 제어점으로 일원화**.

## 배경
v0.7.219는 활성 통합뷰(UnifiedTableConnected, DetailPanel) 5개 useSWR에만 per-hook `revalidateIfStale:true`를 넣어 **구뷰(PriceTableTab/PriceCockpitTab)·suppliers·review·market 등은 미커버**였다. 사용자 요청: "구뷰랑 suppliers/review도 마저 고쳐라, 남기지마라."

## 수정 (단일 제어점)
- `app/(member)/pricing/gpu/GpuPricingClient.tsx`: 반환 JSX 전체를 `<SWRConfig value={{ revalidateIfStale: true }}>`로 래핑(import SWRConfig 추가). → 하위 **모든 탭**의 useSWR이 마운트 재검증:
  통합뷰(board), 구뷰 PriceTableTab/PriceCockpitTab, ReviewTab, SuppliersTab, CompetitorsTab, MarketTab, InventoryTab, SpecsTab, catalog탭, GpuPricingClient 자체 reviewData.
  부모 SWRProvider의 provider(영속캐시)·fetcher·revalidateOnFocus:false는 그대로 상속, revalidateIfStale만 override.
- `components/pricing/gpu/unified/UnifiedTableConnected.tsx`: v0.7.219 per-hook revalidateIfStale 2개 제거(nested가 커버 — 중복 제거, SSOT 일원화).
- `components/pricing/gpu/unified/DetailPanel.tsx`: per-hook 3개 제거(동일).

## 검증 (실DB×Playwright)
- out-of-band로 A100 40GB 지정 NHN→Voltage 변경 후 리로드 → 리스트·견적표 ✓배지 모두 **Voltage로 자가교정**(per-hook 제거 후에도 nested config가 quotes 배지 재검증). baseline NHN 복원 후 다시 NHN으로 치유.
- suppliers 탭·review 탭 정상 렌더(회귀 없음).
- tsc 0 · pricing/parity 22/22 · design:check 통과. 테스트 데이터(is_selected) 원본 복원(A100=NHN).

## 결과
GPU 관리 페이지 하위 가격 SWR이 빠짐없이 마운트 재검증 → 타클라이언트/리로드 stale 제거. **누락 탭 0.**

## 잔여(범위 외)
- 표준 라우트 `/pricing/catalog` 직접 진입(탭 아닌 독립 페이지)은 별도. GPU 관리 탭으로 들어가는 catalog는 커버됨.
- 더 근본적 해법(SyncRevalidator pricing matcher + version 엔드포인트 org-scoped 토큰)은 여전히 별도 옵션이나, 본 nested override로 GPU 관리 화면 stale은 실질 해소.
