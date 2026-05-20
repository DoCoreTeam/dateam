# FAST PATH Summary
작업: 주간보고 입력 폼을 드롭다운 방식 → 테이블 행별 직접 입력 방식으로 변경
대상: apps/web/app/(member)/weekly-report/page.tsx, actions.ts
이유: Word 원안(조직|구분|성과|계획|이슈) 테이블 형식과 동일하게 UX 통일
영향: ReportAccordion.tsx (변경 없음 — 기존 display 로직 유지)
