-- 077_personal_log_guard.sql
-- 🟥 DC-QA/SEC 보강: 개인 일일업무(task_kind='personal')는 부서업무 컬럼을 가질 수 없도록 DB CHECK.
-- → /api/daily/week의 assignee 매칭 확장이 개인 로그 오염으로 이어질 경로를 DB 레벨에서 원천 차단.
-- 적용 전 위반행 0 확인 완료. dept_task 행에는 영향 없음.

alter table public.daily_logs
  add constraint daily_logs_personal_no_dept_fields
  check (task_kind = 'dept_task' or (assignee_user_id is null and department_id is null));
