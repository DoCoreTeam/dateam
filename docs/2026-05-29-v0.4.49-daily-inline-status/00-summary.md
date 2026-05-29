# v0.4.49 — 일일업무 인라인 status 변경

작업: 리스트에서 status 배지 클릭으로 즉시 변경 (수정 페이지 진입 불필요)
대상: actions.ts, page.tsx (LogList 컴포넌트), e2e/daily-inline-status.spec.ts
이유: UX 개선 — 상태 변경을 위해 수정 폼을 열어야 하는 불편 제거
영향: daily page LogList 컴포넌트 / Playwright E2E 추가
