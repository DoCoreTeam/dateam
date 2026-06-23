# FAST PATH Summary — 회의노트 캘린더 기존 캘린더와 통일 (v0.7.260)
작업: MeetingCalendarView를 새 인라인 그리드 대신 기존 /calendar 공용 클래스(calendar-month-board/weekday-row/weekday/month-grid/day-cell/day-number, cal-event-chip)로 재작성.
대상: apps/web/app/(member)/meeting-notes/MeetingCalendarView.tsx
이유: 재사용·단일구현 정책 — 이미 있는 캘린더 그리드와 시각 통일(인라인 repeat(7) 제거, 토큰/클래스 SSOT).
영향: meeting-notes 캘린더 뷰만. 기존 /calendar 무수정. formatKstTime(SSOT) 재사용.
