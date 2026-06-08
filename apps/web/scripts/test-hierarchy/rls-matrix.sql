-- RLS 가시성 매트릭스: 각 테스트 유저의 auth.uid() 시뮬레이션 → 볼 수 있는 [TEST] 주간보고 작성자 목록.
-- 플래그 ON(현재 운영값) vs OFF(롤백 트랜잭션 내부에서만) 비교 → v0.7.38 효과 증명.
-- 운영 영향 0: OFF는 begin/rollback 안에서만 적용, commit 안 함.
\set ON_ERROR_STOP on
\pset format aligned

-- auth.uid() 시뮬레이션 + 가시 주간보고 작성자 반환하는 헬퍼 (임시)
\set honbu '0f83f3ca-ee9c-4b63-800b-addfb326d2d0'
\set lead1 '942ad343-a55d-4a66-a5bf-bef157e791ec'
\set mem1  'a1b13702-62b4-4f98-aa3b-f1d99c628d93'
\set lead2 'f683d19d-7301-4754-8b2a-1bb0693a6543'

create or replace function pg_temp.see(label text, uid uuid) returns table(viewer text, flag text, visible_reports text)
language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select coalesce(string_agg(distinct (select name from profiles where id=w.user_id), ', '),'(없음)')
    into res
    from weekly_reports w
   where w.deleted_at is null and w.category like '[TEST]%';
  perform set_config('role','postgres', true);
  return query select label, (select value from system_settings where key='weekly_report_hierarchy_enabled'), res;
end $$;

\echo
\echo ##################  플래그 ON (운영 현재값 = v0.7.38)  ##################
select * from pg_temp.see('본부장', :'honbu')
union all select * from pg_temp.see('1팀장', :'lead1')
union all select * from pg_temp.see('1팀원', :'mem1')
union all select * from pg_temp.see('2팀장', :'lead2');

\echo
\echo ##################  플래그 OFF (롤백 트랜잭션 — 운영 미반영)  ##################
begin;
update system_settings set value='false' where key='weekly_report_hierarchy_enabled';
select * from pg_temp.see('본부장', :'honbu')
union all select * from pg_temp.see('1팀장', :'lead1')
union all select * from pg_temp.see('1팀원', :'mem1')
union all select * from pg_temp.see('2팀장', :'lead2');
rollback;

\echo
\echo ##################  전사권한(is_executive) 오염 점검 — 전부 false여야 정상  ##################
select '본부장' v, (select set_config('request.jwt.claims', json_build_object('sub',:'honbu','role','authenticated')::text, false)) is not null as _, private.is_executive() exec
union all select '2팀장', (select set_config('request.jwt.claims', json_build_object('sub',:'lead2','role','authenticated')::text, false)) is not null, private.is_executive();

-- 세션 정리
select set_config('request.jwt.claims','', false);
