# v0.7.147 — "확인 안 한 메모" 전체보기 링크 무반응 버그 수정

작업: 메모 위젯 "전체 →"(`/daily?view=memo`) 클릭 시 아무 반응 없던 버그 수정 — URL view 파라미터 변화를 viewMode에 동기화.
대상: `apps/web/app/(member)/daily/page.tsx` (useEffect 1개 추가, ~7줄)
이유: viewMode는 마운트 시 1회만 searchParams에서 초기화(page.tsx:70-71)됨. 이미 `/daily`에 있는 상태에서 `?view=memo`로의 클라이언트 내비게이션은 컴포넌트가 리마운트되지 않아 viewMode가 'day'로 고정 → 메모 뷰 전환 안 됨. 기존 `dateParam` 동기화 패턴과 동일하게 `viewParam` 동기화 effect 추가.
영향: 메모 위젯 "전체 →" 동작 복구(daily 페이지·홈 위젯 공통). MemoListView(메모 뷰)는 기존 그대로. 회귀: 수동 탭 전환은 param 미변경이라 effect 비발화 → 영향 없음.
검증: tsc 0 · 수동 탭(일간/주간/메모) 동작 유지 · "전체 →" 클릭 시 메모 뷰 전환.
