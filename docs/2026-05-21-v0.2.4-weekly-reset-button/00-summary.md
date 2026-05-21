# FAST PATH Summary
작업: CurrentWeekReports 컴포넌트 제거 + WeeklyReportForm에 "이번 주 초기화" 버튼 추가
대상: actions.ts, WeeklyReportForm.tsx, page.tsx
이유: 이번 주 데이터는 이미 폼 입력창에 프리필로 표시 중 — 별도 컴포넌트 불필요. 초기화 버튼 하나로 삭제 = 더 명확한 UX.
영향: CurrentWeekReports.tsx 참조 제거 (파일은 유지), actions.ts에 deleteAllWeeklyReports 추가
