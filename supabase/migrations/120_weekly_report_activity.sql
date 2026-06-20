-- 120_weekly_report_activity.sql
-- 주간보고 작성 타임라인 불변 기록(append-only) + replace_weekly_report RPC 로깅.
-- 왜: 저장이 replace_weekly_report = DELETE+INSERT 라 weekly_reports.created_at/updated_at 이
--     매 저장마다 리셋됨 → "최초/최종 작성시각"의 진실원이 없음. 이 로그가 지연 판정·평가 증빙의 SSOT.

-- ── 1. 활동 로그 테이블 (append-only) ──
create table if not exists weekly_report_activity (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  week_start    date not null,
  department_id uuid references org_nodes(id),     -- 작성시점 부서 동결(보고서와 동일 정책)
  action        text not null check (action in ('create','edit','delete')),
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,                              -- 통상 user_id, 대리수정 추적용
  content_hash  text                               -- 의미있는 변경 식별(옵션)
);

create index if not exists idx_wra_week on weekly_report_activity (week_start);
create index if not exists idx_wra_user_week on weekly_report_activity (user_id, week_start);
create index if not exists idx_wra_dept_week on weekly_report_activity (department_id, week_start);

-- ── 2. RLS (append-only: SELECT/INSERT 만, UPDATE/DELETE 정책 없음 → 불변) ──
alter table weekly_report_activity enable row level security;

-- SELECT: 주간보고 가시성과 동일(플래그 OFF면 전원, ON이면 본인+관할부서+전사)
drop policy if exists wra_select on weekly_report_activity;
create policy wra_select on weekly_report_activity
for select to authenticated
using (
  (not (select private.hierarchy_enabled()))
  or user_id = (select auth.uid())
  or department_id = any(private.my_readable_dept_ids())
  or (select private.is_executive())
);

-- INSERT: 본인 행만 (RPC가 security invoker 로 호출자=작성자 컨텍스트에서 기록)
drop policy if exists wra_insert on weekly_report_activity;
create policy wra_insert on weekly_report_activity
for insert to authenticated
with check (user_id = (select auth.uid()));
-- UPDATE/DELETE 정책 없음 = 누구도 수정/삭제 불가(증빙 불변성). admin client(service_role)는 RLS 우회.

-- ── 3. replace_weekly_report RPC: 저장 시 활동 로그 1건 기록 (create/edit 구분) ──
create or replace function replace_weekly_report(
  p_week_start date,
  p_rows       jsonb
) returns void language plpgsql security invoker as $$
declare
  v_dept    uuid;
  v_existed boolean;
begin
  select department_id into v_dept
  from v_user_departments where user_id = auth.uid() limit 1;

  -- 기존 보고 존재 여부 → 로그 action(create vs edit) 판별 (DELETE 전에 확인)
  select exists(
    select 1 from weekly_reports
    where user_id = auth.uid() and week_start = p_week_start
  ) into v_existed;

  delete from weekly_reports
  where user_id = auth.uid() and week_start = p_week_start;

  insert into weekly_reports (user_id, week_start, category, performance, plan, issues, department_id, deleted_at)
  select auth.uid(), p_week_start,
         (elem->>'category')::text, (elem->>'performance')::text,
         (elem->>'plan')::text, (elem->>'issues')::text,
         v_dept, null
  from jsonb_array_elements(p_rows) as elem;

  insert into weekly_report_activity (user_id, week_start, department_id, action, actor_id)
  values (auth.uid(), p_week_start, v_dept,
          case when v_existed then 'edit' else 'create' end, auth.uid());
end; $$;

-- ── 4. 기존 보고 백필 (best-effort: 최초 작성 1건 = min(created_at)) ──
-- 도입 이전 정확한 수정 이력은 복원 불가 → 정식 증빙은 도입 이후 기록 기준.
insert into weekly_report_activity (user_id, week_start, department_id, action, occurred_at, actor_id)
select wr.user_id, wr.week_start, (array_agg(wr.department_id))[1], 'create', min(wr.created_at), wr.user_id
from weekly_reports wr
where wr.deleted_at is null
group by wr.user_id, wr.week_start;
