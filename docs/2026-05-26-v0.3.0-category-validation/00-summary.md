# FAST PATH Summary
작업: 주간보고 폼 구분(category) 필수 입력 클라이언트 검증 추가
대상: apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx
이유: category 비워두면 actions.ts에서 해당 행이 필터링되어 조용히 실패 → 사용자가 이유를 모름
영향: 없음 (클라이언트 검증만, 서버/DB 변경 없음)
