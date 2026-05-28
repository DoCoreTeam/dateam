# FAST PATH Summary — v0.4.26

작업: 캘린더·일일업무 기본 UX 버그 4개 수정
대상: calendar/page.tsx, DayDetailPanel.tsx, api/daily/logs/route.ts, daily/page.tsx, daily/actions.ts
이유: 사용자가 캘린더 날짜 클릭 시 내용이 없고, 자동으로 패널이 열리며, 날짜 변경 불가, 외부 클릭 닫기 미작동
영향: 캘린더·일일업무 페이지 전반

## 버그 & 수정 내용

| # | 버그 | 원인 | 수정 |
|---|------|------|------|
| 1 | 캘린더 진입 시 오늘 날짜 패널 자동 오픈 | `selectedDate = todayStr` 초기값 | `null` 로 변경 |
| 2 | 날짜 클릭 시 패널 비어있음 (target_date 기준 이벤트) | `/api/daily/logs` 가 `log_date` 만 조회 | `target_date` OR 조건 추가 |
| 3 | 일정 날짜(target_date) 변경 불가 | edit 폼에 날짜 입력 없음 + 수정 버튼이 오늘만 노출 | 날짜 input 추가, 모든 날짜에서 수정 가능 |
| 4 | 외부 클릭 시 패널 닫기 미작동 | backdrop이 `main[overflowY:auto]` 안에 갇혀 stacking context 이슈 | React portal 로 document.body 에 렌더 |
