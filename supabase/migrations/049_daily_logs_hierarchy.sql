-- 049_daily_logs_hierarchy.sql
-- Phase 4 — 캘린더(=daily_logs 날짜뷰)에 조직 계층 가시성 적용
-- daily_logs는 이미 "본인+admin"만 조회. 여기에 "상위/부서장이 관할 부서원 로그 조회"를 추가(가시성 확장).
-- 동일 피처플래그(weekly_report_hierarchy_enabled)로 게이팅 → OFF면 기존(본인+admin) 동작 100% 유지.
-- 별도 컬럼 없이 "현재 소속" 기준으로 판정(캘린더는 스냅샷이 아닌 현재 상태이므로 정확).

-- 내가 조회 가능한 사용자 id 배열 = (내 readable 부서에 현재 소속된 person들) + 본인
create or replace function private.my_readable_user_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select distinct p.user_id
    from public.org_nodes p
    where p.type = 'person'
      and p.user_id is not null
      and p.parent_id = any(private.my_readable_dept_ids())
    union
    select (select auth.uid())
  );
end; $$;
grant execute on function private.my_readable_user_ids() to authenticated;

-- daily_logs SELECT 정책 교체: 본인 OR admin OR (플래그 ON 시: 관할 부서원 OR 전사)
drop policy if exists daily_logs_select on daily_logs;
create policy daily_logs_select on daily_logs
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null
  )
  or (
    (select private.hierarchy_enabled())
    and (
      user_id = any(private.my_readable_user_ids())
      or (select private.is_executive())
    )
  )
);
-- INSERT/UPDATE/DELETE 정책은 기존(본인만) 유지 — 변경 없음.
