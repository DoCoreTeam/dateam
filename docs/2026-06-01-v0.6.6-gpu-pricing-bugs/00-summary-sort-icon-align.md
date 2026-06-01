# GPU 가격표 헤더 정렬 아이콘 정렬 수정

## 작업 요약
GPU 관리 > 가격표 탭의 컬럼 헤더에서 정렬(sort) 아이콘이 타이틀에서 떨어져 레이아웃이 틀어지는 문제 수정. 타이틀 + 보조설명 + 정렬 아이콘을 inline-flex로 묶어 항상 한 묶음으로 타이틀 바로 옆에 위치하도록 변경.

## 수정 파일
- `apps/web/app/(member)/pricing/gpu/tabs/PriceTableTab.tsx`
  - `SortIcon`: `marginLeft`/`verticalAlign` 인라인 스타일 제거 → flex 컨테이너의 `gap`이 간격 처리, `flexShrink:0`로 아이콘 축소 방지
  - 정렬 가능한 헤더 3개(GPU 모델 / 최저 공급가 / gcube 판매가) 내용을 `<span className="gpu-th-sort">`로 래핑, 우측 정렬 컬럼은 `gpu-th-sort-r` 추가
- `apps/web/app/globals.css`
  - `.gpu-th-sort { display:inline-flex; align-items:center; gap:4px; vertical-align:middle; }`
  - `.gpu-th-sort-r { justify-content:flex-end; }`

## 변경 이유
기존엔 헤더 셀이 `raw text + note span + inline svg(verticalAlign/marginLeft)` 혼합 구조라 컬럼 폭/nowrap 조합에서 아이콘이 시각적으로 분리되어 보였음. flex 래퍼로 묶어 항상 타이틀 옆에 수직 중앙 정렬로 고정.

## 영향 범위
- 데스크탑 가격표 헤더 표시만 변경. 모바일은 `.gpu-table thead { display:none }`이라 영향 없음.
- 정렬 클릭 동작(`handleSort`)은 `th onClick` 그대로 유지 — 기능 변화 없음.
- TypeScript 컴파일 통과.
