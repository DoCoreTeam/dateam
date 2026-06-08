-- [TEST] 데이터 정리: 주간보고/캘린더/조직노드(aaaa0000-%) 삭제. auth/profiles는 cleanup-users.mjs가 처리.
\set ON_ERROR_STOP on
\set honbu '0f83f3ca-ee9c-4b63-800b-addfb326d2d0'
\set lead1 '942ad343-a55d-4a66-a5bf-bef157e791ec'
\set mem1  'a1b13702-62b4-4f98-aa3b-f1d99c628d93'
\set lead2 'f683d19d-7301-4754-8b2a-1bb0693a6543'

delete from weekly_reports  where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from calendar_events where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
delete from org_nodes       where id::text like 'aaaa0000-%';

\echo ===== 잔여 확인 (모두 0이어야 정상) =====
select 'org_nodes' t, count(*) from org_nodes where id::text like 'aaaa0000-%'
union all select 'weekly_reports', count(*) from weekly_reports where user_id in (:'honbu',:'lead1',:'mem1',:'lead2')
union all select 'calendar_events', count(*) from calendar_events where user_id in (:'honbu',:'lead1',:'mem1',:'lead2');
