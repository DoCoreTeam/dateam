# FAST PATH Summary
작업: 전주 계획 → 이번 주 성과 carry-forward 구현
대상: apps/web/app/(member)/weekly-report/page.tsx, WeeklyReportForm.tsx
이유: 이번 주 보고가 없을 때 전주 계획을 성과란에 미리 채워 빈 폼 진입을 방지
영향: 추가 DB 쿼리 없음 (기존 reports 배열 재활용), 저장 시 carry-forward 내용 덮어쓰기
