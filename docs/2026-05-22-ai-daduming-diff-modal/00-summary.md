# FAST PATH Summary
작업: AI로 다듬기 — diff 확인 모달 + 전체화면 로딩 오버레이 구현
대상: components/ui/DiffConfirmModal.tsx (신규), WeeklyReportForm.tsx (수정)
이유: AI 결과 즉시 덮어쓰기 대신 셀별 accept/reject 확인 단계 추가 + 어드민 로딩 스타일 통일
영향: WeeklyReportForm 단독 — 저장/초기화 흐름 변경 없음
