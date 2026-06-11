# GPU 5탭 모델 표시 통일 (v0.7.74)

## 작업
가격표·가격결정·시장비교·재고수량·고객판매가격표 5탭의 "모델 목록 표시"를 동일 패턴으로 통일.

## 불일치 (DC-ANA)
- cockpit만 flat(나머지 4탭 Tier그룹), 그룹 구현 3종 분산(공용 vs PriceTable/Market 인라인)
- InventoryTab GpuModelName 미사용, Market 조건부
- Market 검색·Tier필터 없음
- SortIcon 3종(인라인 2 + cockpit 공용)

## 통일 기준 (공용 SSOT 수렴)
전 5탭 공통:
- Tier→모델 2단계 접힘 그룹: 공용 `lib/gpu/group.ts(buildTierModelGroups/tierKey/modelKey)` + `components/gpu/CategoryGroup.tsx(TierHeader/ModelHeader)` + `hooks/useCollapsibleGroups`
- 모델 셀: `components/pricing/gpu/GpuModelName.tsx`(모델명+×N) — 전 탭 적용(Inventory 추가, Market 조건분기 제거)
- 모델 검색 input + Tier 필터(gpu-seg) — 전 탭(Market에 추가)
- SortIcon 공용화: cockpit 경로 → `components/pricing/gpu/SortIcon.tsx`로 이동, PriceTable/Market 인라인 제거
탭별 유지: 고유 데이터 컬럼·고유 필터(경쟁사 그룹/포지션, 시간계산기)·레이아웃(Inventory 카드).

## 대상 파일
- tabs/PriceTableTab.tsx(인라인 그룹/SortIcon→공용), PriceCockpitTab.tsx(flat→Tier그룹), MarketTab.tsx(인라인 그룹→공용+검색/Tier필터+GpuModelName), InventoryTab.tsx(GpuModelName), catalog/page.tsx(이미 공용 — 정합 확인)
- components/pricing/gpu/SortIcon.tsx 이동, globals.css 필요시

## 검증
브라우저로 5탭 각각 동일 그룹/모델셀/검색·필터 확인. tsc/design/test PASS. 회귀 0(데이터·기능 유지).
