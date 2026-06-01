-- 047_weekly_report_hierarchy.sql
-- Phase 2 — 주간보고 부서 동결 + 계층 격리 RLS (피처플래그 기본 OFF)
-- 핵심 안전장치: 플래그 OFF면 기존 "전원 열람" 동작을 100% 유지 → 라이브 브레이킹 방지.

-- ── 1. weekly_reports에 작성시점 부서 동결 컬럼 ──
alter table weekly_reports
  add column if not exists department_id uuid references org_nodes(id);

create index if not exists idx_weekly_reports_department on weekly_reports (department_id);

-- 기존 행 백필: 작성자의 현재 소속 부서 (없으면 null 유지)
update weekly_reports wr
set department_id = vud.department_id
from v_user_departments vud
where vud.user_id = wr.user_id
  and wr.department_id is null;

-- ── 2. 피처플래그 (system_settings) ──
insert into system_settings (key, value) values ('weekly_report_hierarchy_enabled', 'false')
on conflict (key) do nothing;

create or replace function private.hierarchy_enabled()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select value into v from public.system_settings where key = 'weekly_report_hierarchy_enabled';
  return coalesce(v, 'false') = 'true';
end; $$;
grant execute on function private.hierarchy_enabled() to authenticated;

-- ── 3. 작성 RPC: department_id 자동 동결 ──
create or replace function replace_weekly_report(
  p_week_start date,
  p_rows       jsonb
) returns void language plpgsql security invoker as $$
declare v_dept uuid;
begin
  select department_id into v_dept
  from v_user_departments where user_id = auth.uid() limit 1;

  delete from weekly_reports
  where user_id = auth.uid() and week_start = p_week_start;

  insert into weekly_reports (user_id, week_start, category, performance, plan, issues, department_id, deleted_at)
  select auth.uid(), p_week_start,
         (elem->>'category')::text, (elem->>'performance')::text,
         (elem->>'plan')::text, (elem->>'issues')::text,
         v_dept, null
  from jsonb_array_elements(p_rows) as elem;
end; $$;

-- ── 4. 격리 SELECT 정책 (플래그 게이팅) ──
-- 플래그 OFF → 전원 열람(기존 002 동작). ON → 본인+관할부서+전사만.
drop policy if exists weekly_reports_select on weekly_reports;
create policy weekly_reports_select on weekly_reports
for select to authenticated
using (
  deleted_at is null
  and (
    (not (select private.hierarchy_enabled()))           -- OFF: 기존 전원열람
    or user_id = (select auth.uid())                      -- 본인
    or department_id = any(private.my_readable_dept_ids())  -- 관할 부서(자기+하위)
    or (select private.is_executive())                    -- 전사
  )
);
-- INSERT/UPDATE/DELETE는 기존(본인만) 유지 — 별도 변경 없음.
