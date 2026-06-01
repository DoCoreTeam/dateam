# FAST PATH Summary — v0.4.16

작업: 캘린더↔일일업무 연동 버그 수정 + 전체 연결 기능 테스트 및 정상화

## 발견된 버그

### Bug 1 (CONFIRMED): URL date 파라미터 미반영
- 증상: DayDetailPanel "보기" 클릭 → `/daily?date=YYYY-MM-DD` 이동 시 해당 날짜 업무가 표시 안 됨
- 원인: `daily/page.tsx`에서 `useState(initialDate)` 는 최초 마운트 시에만 적용. URL 파라미터(`searchParams`)가 변경되어도 `selectedDate` 상태가 업데이트되지 않음
- 수정: `useEffect`에서 `searchParams` 변화를 감지해 `selectedDate` 및 `viewMode`를 동기화

## 수정 파일

- `apps/web/app/(member)/daily/page.tsx` — URL date 파라미터 동기화 useEffect 추가

## 영향 범위

- 캘린더 → DayDetailPanel "보기" → daily 페이지 날짜 표시 (직접 수정)
- 캘린더 주간 "보기" 버튼 → DayDetailPanel (연관, 정상 동작 확인)
- daily 주간 "보기" → 일간 뷰 전환 (연관, 정상 동작 확인)
