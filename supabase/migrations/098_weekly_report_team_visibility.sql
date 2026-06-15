-- 098_weekly_report_team_visibility.sql
-- 주간보고 "팀 전체" = 본인 소속 부서(같은 부서) 전원 가시화.
-- 배경: 050 격리 정책 + 074 플래그 ON 상태에서 평팀원은 head가 아니라
--   my_managed_dept_ids()가 비어 본인 보고만 보였음 → "팀 전체"에 동료가 안 보임.
-- 기획: 팀 전체 = 조직도 기준 '같은 소속 부서' 전원. 하위 서브트리는 '조직현황'이며
--   해당/상위 부서 조직장(head)이 my_managed_dept_ids()로 봄(현행 유지).
-- 본 변경은 가산적(SELECT 완화)이며 데이터 무변경. 타 부서 노출 없음(정확 부서만, 서브트리 아님).

-- 본인이 직접 소속된 부서노드 id(들) — person 노드의 parent dept. 서브트리 미포함(순수 소속).
create or replace function private.my_team_dept_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select department_id from public.v_user_departments
    where user_id = (select auth.uid())
  );
end; $$;
grant execute on function private.my_team_dept_ids() to authenticated;

-- weekly_reports SELECT 재정의: 본인 OR 같은 소속부서(팀 전체·신규) OR 관리 서브트리(조직장) OR 전사
drop policy if exists weekly_reports_select on weekly_reports;
create policy weekly_reports_select on weekly_reports
for select to authenticated
using (
  deleted_at is null
  and (
    (not (select private.hierarchy_enabled()))                 -- OFF: 기존 전원열람
    or user_id = (select auth.uid())                            -- 본인
    or department_id = any(private.my_team_dept_ids())          -- 같은 소속 부서(팀 전체)
    or department_id = any(private.my_managed_dept_ids())       -- 내가 관리하는 서브트리(조직장 취합)
    or (select private.is_executive())                          -- 전사
  )
);
