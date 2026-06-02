-- 050_member_individual_isolation.sql
-- (b) 팀원은 동료의 "개별" 보고를 못 보고 본인 것 + 부서 "취합본"만 본다.
-- 개별 보고 가시성을 "관리 서브트리(내가 head인 노드의 하위)"로 좁힌다.
-- 평팀원은 head인 노드가 없으므로 개별 보고는 본인 것만 보임. 부서장/상위는 관할 개별 보고 조회(취합용).
-- 부서 취합본(dept_weekly_reports)은 기존대로 my_readable_dept_ids(소속 부서 포함)라 팀원도 본인 부서 취합본은 봄.

-- 내가 관리(head)하는 노드의 서브트리 부서 id (소속 부서는 제외 — 순수 관리 범위)
create or replace function private.my_managed_dept_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select distinct c.descendant_id
    from public.org_node_closure c
    where c.ancestor_id in (
      select id from public.org_nodes where head_user_id = (select auth.uid())
    )
  );
end; $$;
grant execute on function private.my_managed_dept_ids() to authenticated;

-- weekly_reports 개별 보고 SELECT: 본인 OR admin OR (플래그 ON: 관리 서브트리 OR 전사)
drop policy if exists weekly_reports_select on weekly_reports;
create policy weekly_reports_select on weekly_reports
for select to authenticated
using (
  deleted_at is null
  and (
    (not (select private.hierarchy_enabled()))                 -- OFF: 기존 전원열람
    or user_id = (select auth.uid())                            -- 본인
    or department_id = any(private.my_managed_dept_ids())       -- 내가 관리하는 부서(취합용)
    or (select private.is_executive())                          -- 전사
  )
);

-- daily_logs(캘린더)도 동일 일관성: 본인 + 관리 서브트리 멤버만 (동료 평팀원끼리 비가시)
create or replace function private.my_readable_user_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select distinct p.user_id
    from public.org_nodes p
    where p.type = 'person'
      and p.user_id is not null
      and p.parent_id = any(private.my_managed_dept_ids())   -- 관리 서브트리 멤버
    union
    select (select auth.uid())                                -- 본인
  );
end; $$;
