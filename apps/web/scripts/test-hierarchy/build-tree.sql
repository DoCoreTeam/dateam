-- [TEST] 계층 검증 트리 + 시드. 모든 노드 id 접두 'aaaa0000-%' → cleanup에서 일괄 삭제.
-- 사용법: psql ... -v honbu=.. -v lead1=.. -v mem1=.. -v lead2=.. -f build-tree.sql
\set ON_ERROR_STOP on

-- 멱등: 기존 테스트 잔여 제거
delete from weekly_reports where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from calendar_events where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from org_nodes where id::text like 'aaaa0000-%';

-- 부서 트리 (root = 데이터얼라이언스)
insert into org_nodes (id, type, parent_id, name, display_order, head_user_id) values
 ('aaaa0000-0000-4000-8000-000000000001','department',(select id from org_nodes where parent_id is null),'[TEST]그룹',900,null),
 ('aaaa0000-0000-4000-8000-000000000002','department','aaaa0000-0000-4000-8000-000000000001','[TEST]본부',901,:'honbu'),
 ('aaaa0000-0000-4000-8000-000000000003','department','aaaa0000-0000-4000-8000-000000000002','[TEST]1팀',902,:'lead1'),
 ('aaaa0000-0000-4000-8000-000000000004','department','aaaa0000-0000-4000-8000-000000000002','[TEST]2팀',903,:'lead2');

-- person 노드 (소속 부서 매핑)
insert into org_nodes (id, type, parent_id, name, display_order, user_id) values
 ('aaaa0000-0000-4000-8000-000000000011','person','aaaa0000-0000-4000-8000-000000000002','[TEST]본부장',1,:'honbu'),
 ('aaaa0000-0000-4000-8000-000000000012','person','aaaa0000-0000-4000-8000-000000000003','[TEST]1팀장',2,:'lead1'),
 ('aaaa0000-0000-4000-8000-000000000013','person','aaaa0000-0000-4000-8000-000000000003','[TEST]1팀원',3,:'mem1'),
 ('aaaa0000-0000-4000-8000-000000000014','person','aaaa0000-0000-4000-8000-000000000004','[TEST]2팀장',4,:'lead2');

-- 주간보고 시드 (이번 주, 각자 본인 부서)
insert into weekly_reports (user_id, week_start, category, performance, plan, issues, department_id) values
 (:'honbu', date_trunc('week',current_date)::date, '[TEST]본부총괄','[TEST]본부장 실적','[TEST]본부장 계획','[TEST]본부장 이슈','aaaa0000-0000-4000-8000-000000000002'),
 (:'lead1', date_trunc('week',current_date)::date, '[TEST]1팀','[TEST]1팀장 실적','[TEST]1팀장 계획','[TEST]1팀장 이슈','aaaa0000-0000-4000-8000-000000000003'),
 (:'mem1',  date_trunc('week',current_date)::date, '[TEST]1팀','[TEST]1팀원 실적','[TEST]1팀원 계획','[TEST]1팀원 이슈','aaaa0000-0000-4000-8000-000000000003'),
 (:'lead2', date_trunc('week',current_date)::date, '[TEST]2팀','[TEST]2팀장 실적','[TEST]2팀장 계획','[TEST]2팀장 이슈','aaaa0000-0000-4000-8000-000000000004');

\echo ===== 트리 확인 =====
select substr(id::text,1,13) id13, type, name, substr(parent_id::text,1,13) parent13,
       coalesce((select name from profiles where id=org_nodes.head_user_id),'') head
from org_nodes where id::text like 'aaaa0000-%' order by display_order;
\echo ===== 시드된 주간보고 =====
select (select name from profiles where id=user_id) author, category from weekly_reports where user_id in (:'honbu',:'lead1',:'mem1',:'lead2') order by 1;
