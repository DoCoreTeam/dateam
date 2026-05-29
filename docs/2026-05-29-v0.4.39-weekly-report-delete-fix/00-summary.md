# FAST PATH Summary

작업: 주간보고 행 삭제 후 새로고침 시 재출현 버그 수정
대상: apps/web/app/(member)/weekly-report/actions.ts
이유: upsertWeeklyReport가 upsert 전략을 사용하여 form에서 제거된 행이 DB에 잔존함. 저장 시 해당 week_start의 기존 행을 먼저 삭제하고 새로 insert하도록 변경 (atomic replace).
영향: WeeklyReportForm.tsx의 removeRow — 클라이언트 UI 로직 변경 없음
