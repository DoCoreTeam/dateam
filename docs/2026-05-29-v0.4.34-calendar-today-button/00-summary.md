# FAST PATH Summary — v0.4.34

작업: 캘린더 월간 뷰 오늘 이동 버튼 추가
대상: calendar/page.tsx
이유: 다른 달을 보고 있을 때 현재 월로 바로 돌아오는 컨트롤이 없어 탐색이 불편함
영향: 캘린더 월간 네비게이션

## 수정 내용

| # | 변경 | 내용 |
|---|------|------|
| 1 | 월간 오늘 버튼 | 현재 월이 아닐 때 월 네비게이션 옆에 `오늘` 버튼 표시 |
| 2 | 기존 디자인 재사용 | 주간 뷰와 같은 `calendar-nav-btn is-today-btn` 클래스 사용 |
| 3 | 버전 동기화 | package, web package, AGENTS, GEMINI, CLAUDE를 v0.4.34로 동기화 |
