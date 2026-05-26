# FAST PATH Summary
작업: LeadIntakeForm handleTextSubmit/handleCreate useRef 동기 플래그로 이중 제출 Race Condition 수정
대상: apps/web/app/(member)/lead-intake/LeadIntakeForm.tsx
이유: Ctrl+Enter 연타 시 React state 재렌더 전에 두 번째 API 호출 실행 → lead_intakes 중복 INSERT
영향: LeadIntakeForm.tsx 단일 파일 — 다른 폼(WeeklyReportForm 등 5개)은 별도 스프린트로 보강
