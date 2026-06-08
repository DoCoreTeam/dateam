-- 부서업무 S1 검증: 트리 + 개인로그(회귀) + 부서업무 + 댓글 시드 → RLS 매트릭스.
-- 운영 무오염: 노드 aaaa0000-%, 로그/스레드는 테스트 user_id로만. 종료 후 dept-task-cleanup.sql.
\set ON_ERROR_STOP on
\pset format aligned
\set honbu '66db7c36-557a-40d4-9056-fb275208a540'
\set lead1 '0ce17e90-3fe0-45bd-a39b-f6c1459156c8'
\set mem1  '99aac80a-d667-4dd3-862f-a8ac42cd6d7e'
\set lead2 '2a9f02b1-5ede-4cc0-8d8f-f7de0f879af7'

-- 트리 (멱등)
delete from daily_log_threads where author_user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from daily_logs where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from org_nodes where id::text like 'aaaa0000-%';
insert into org_nodes (id,type,parent_id,name,display_order,head_user_id) values
 ('aaaa0000-0000-4000-8000-000000000001','department',(select id from org_nodes where parent_id is null),'[TEST]그룹',900,null),
 ('aaaa0000-0000-4000-8000-000000000002','department','aaaa0000-0000-4000-8000-000000000001','[TEST]본부',901,:'honbu'),
 ('aaaa0000-0000-4000-8000-000000000003','department','aaaa0000-0000-4000-8000-000000000002','[TEST]1팀',902,:'lead1'),
 ('aaaa0000-0000-4000-8000-000000000004','department','aaaa0000-0000-4000-8000-000000000002','[TEST]2팀',903,:'lead2');
insert into org_nodes (id,type,parent_id,name,display_order,user_id) values
 ('aaaa0000-0000-4000-8000-000000000011','person','aaaa0000-0000-4000-8000-000000000002','[TEST]본부장',1,:'honbu'),
 ('aaaa0000-0000-4000-8000-000000000012','person','aaaa0000-0000-4000-8000-000000000003','[TEST]1팀장',2,:'lead1'),
 ('aaaa0000-0000-4000-8000-000000000013','person','aaaa0000-0000-4000-8000-000000000003','[TEST]1팀원',3,:'mem1'),
 ('aaaa0000-0000-4000-8000-000000000014','person','aaaa0000-0000-4000-8000-000000000004','[TEST]2팀장',4,:'lead2');

-- 개인 일일업무 (task_kind 기본 personal) — 회귀 검증용
insert into daily_logs (user_id, log_date, content, entry_type) values
 (:'mem1', current_date, '[TEST]1팀원 개인업무', 'doing'),
 (:'lead2',current_date, '[TEST]2팀장 개인업무', 'doing');

-- 부서업무 (dept_task): 작성자=본부장, 담당자/부서 지정
insert into daily_logs (user_id, log_date, content, entry_type, task_kind, assignee_user_id, department_id, progress) values
 (:'honbu', current_date, '[TEST]1팀 부서업무(담당:1팀원)', 'doing', 'dept_task', :'mem1', 'aaaa0000-0000-4000-8000-000000000003', 30),
 (:'honbu', current_date, '[TEST]2팀 부서업무(담당:2팀장)', 'doing', 'dept_task', :'lead2','aaaa0000-0000-4000-8000-000000000004', 50);

-- 댓글: 1팀원이 1팀 부서업무에 진행 댓글
insert into daily_log_threads (log_id, author_type, content, author_user_id)
 select id, 'user', '[TEST]1팀원 진행 댓글', :'mem1' from daily_logs
 where content='[TEST]1팀 부서업무(담당:1팀원)' limit 1;

-- 시뮬레이션 헬퍼
create or replace function pg_temp.see_personal(uid uuid) returns text language plpgsql as $$
declare r text; begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid::text,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select coalesce(string_agg(content,', ' order by content),'(없음)') into r from daily_logs
    where content like '[TEST]%' and task_kind='personal';
  perform set_config('role','postgres', true); return r; end $$;
create or replace function pg_temp.see_dept(uid uuid) returns text language plpgsql as $$
declare r text; begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid::text,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select coalesce(string_agg(content,', ' order by content),'(없음)') into r from daily_logs
    where content like '[TEST]%' and task_kind='dept_task';
  perform set_config('role','postgres', true); return r; end $$;
create or replace function pg_temp.see_threads(uid uuid) returns text language plpgsql as $$
declare r text; begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid::text,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select coalesce(string_agg(content,', '),'(없음)') into r from daily_log_threads where content like '[TEST]%';
  perform set_config('role','postgres', true); return r; end $$;

\echo
\echo ===== ① 개인 일일업무 가시성 (회귀 검증 — 2팀장은 1팀원 개인업무 보면 안 됨) =====
select '본부장' v, pg_temp.see_personal(:'honbu') personal union all
select '1팀장', pg_temp.see_personal(:'lead1') union all
select '1팀원', pg_temp.see_personal(:'mem1') union all
select '2팀장', pg_temp.see_personal(:'lead2');

\echo
\echo ===== ② 부서업무 가시성 (1팀장=1팀만, 2팀장=2팀만, 본부장=둘다) =====
select '본부장' v, pg_temp.see_dept(:'honbu') dept_tasks union all
select '1팀장', pg_temp.see_dept(:'lead1') union all
select '1팀원', pg_temp.see_dept(:'mem1') union all
select '2팀장', pg_temp.see_dept(:'lead2');

\echo
\echo ===== ③ 댓글 가시성 (1팀 관계자만, 2팀장 차단) =====
select '본부장' v, pg_temp.see_threads(:'honbu') threads union all
select '1팀장', pg_temp.see_threads(:'lead1') union all
select '1팀원', pg_temp.see_threads(:'mem1') union all
select '2팀장', pg_temp.see_threads(:'lead2');

select set_config('request.jwt.claims','', false);
