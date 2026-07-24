-- 178 — 일일업무 기간(범위) 일정 지원. "다음주" 같은 상대·기간 표현을 [target_date, target_end_date] 밴드로.
-- additive — 기존 단일 시점(target_date/scheduled_at) 무영향. NULL이면 단일 날짜(기존 동작).
alter table daily_logs
  add column if not exists target_end_date date;

comment on column daily_logs.target_end_date is '기간 일정의 종료일(캘린더 밴드). NULL=단일 날짜/시점.';
