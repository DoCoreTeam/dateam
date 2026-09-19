-- 보안 다섯 줄 세기 — 전부 0 이어야 함 (docs/policy/security.md)
\pset tuples_only on
select 'rls_off_tables|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

select 'anon_write_tables|' || count(distinct table_name) from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

select 'public_using_true_policies|' || count(*) from pg_policies
where schemaname = 'public' and 'public' = any(roles) and qual = 'true';

select 'unpinned_secdef_functions|' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));

select 'anon_readable_secdef_views|' || count(*) from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public' and g.grantee = 'anon'
  and g.privilege_type = 'SELECT' and c.relkind = 'v';
