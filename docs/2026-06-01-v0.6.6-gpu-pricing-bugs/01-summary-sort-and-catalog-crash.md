# 시장비교·재고수량 정렬 추가 + 고객판매가격표 크래시 수정

## 작업 요약
- **고객 판매가격표(catalog)**: 클릭 시 `TypeError: Cannot read properties of null (reading 'replace')` 크래시 수정. 정렬 헤더는 기존에 이미 구현돼 있어 별도 작업 불필요.
- **시장비교(MarketTab) 전략요약 테이블**: 6개 컬럼 전체 클릭 정렬 추가 (가격표와 동일 UX — 아이콘이 타이틀 옆).
- **재고수량(InventoryTab)**: 카드 리스트라 헤더 클릭 불가 → 툴바에 정렬 드롭다운 추가.

## 수정 파일
1. `apps/web/app/(member)/pricing/catalog/page.tsx`
   - `GpuChip`: `memory.replace(...)` → `(memory ?? '').replace(...)`, `model[0]` → `(model ?? '')[0]` (null 데이터 방어)
2. `apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx`
   - `StratSortKey` 타입 + `StratSortIcon` 컴포넌트 추가 (ArrowUpDown/Up/Down)
   - `StrategyOverviewPanel`에 `sortKey`/`sortDir` 상태 + `handleSort` + `sortedRows` 추가
   - 헤더 6개를 클릭 가능한 정렬 헤더로 변경, `rows.map` → `sortedRows.map`
   - 데이터 부족(scn=null) 행은 정렬과 무관하게 항상 하단 고정
3. `apps/web/app/(member)/pricing/gpu/tabs/InventoryTab.tsx`
   - `sortKey` 상태(`tier`/`model`/`qty_desc`/`qty_asc`) + `availQty()` + `sorted` 추가
   - 툴바에 정렬 `<select>` 드롭다운 추가, `filtered.map` → `sorted.map`

## 검증
- TypeScript 컴파일 통과(4파일).
- `/pricing/gpu`, `/pricing/catalog` 모두 307(인증 리다이렉트)로 컴파일 정상 — 500 없음.
- ⚠️ 인증 보호 라우트 + 실행 중 브라우저 프로파일 잠금으로 헤드리스 자동 브라우저 테스트는 불가 → 사용자 탭 새로고침(HMR)으로 확인 필요.

## 영향 범위
- 정렬 로직만 추가, 데이터/저장 로직 변화 없음. 모바일 영향 없음(카드/그리드 유지).
