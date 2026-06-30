-- 139_weekly_report_items_hardening.sql
-- 138 항목 테이블 보완 — DC-REV/DC-SEC 지적 반영:
--   (1) 생성 멱등/레이스 + 0건 재호출 방지용 생성기록 테이블(H1·P4)
--   (2) items 교체 저장 단일 트랜잭션 RPC(H2: route의 delete+insert 비트랜잭션 제거)
--   (3) SELECT 정책 축소(SEC M-2: 편집 중 작업영역을 부서장에게 노출하지 않음 — 확정본 weekly_reports만 공유)

-- ── 1. 생성 기록(클레임) 테이블 ──
-- 같은 (user, week) 동시 첫진입 시 둘 다 생성→중복 토큰/행 방지. 0건이어도 행을 남겨 재생성 차단.
create table if not exists weekly_report_draft_gen (
  user_id      uuid not null references profiles(id),
  week_start   date not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table weekly_report_draft_gen enable row level security;
drop policy if exists wrdg_select on weekly_report_draft_gen;
create policy wrdg_select on weekly_report_draft_gen
for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists wrdg_insert on weekly_report_draft_gen;
create policy wrdg_insert on weekly_report_draft_gen
for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists wrdg_delete on weekly_report_draft_gen;
create policy wrdg_delete on weekly_report_draft_gen
for delete to authenticated using (user_id = (select auth.uid()));

-- ── 2. items 교체 저장 RPC (단일 트랜잭션) ──
-- route의 delete+insert(부분실패 시 작업영역 소실)를 대체. department_id는 작성시점 부서 동결.
create or replace function replace_weekly_report_items(
  p_week_start date,
  p_items      jsonb
) returns void language plpgsql security invoker as $$
declare
  v_dept uuid;
begin
  select department_id into v_dept
  from v_user_departments where user_id = auth.uid() limit 1;

  delete from weekly_report_items
  where user_id = auth.uid() and week_start = p_week_start;

  insert into weekly_report_items
    (user_id, week_start, department_id, category, section, content,
     origin, confidence, is_included, source_ref, sort_order)
  select
    auth.uid(), p_week_start, v_dept,
    coalesce(elem->>'category', ''),
    elem->>'section',
    coalesce(elem->>'content', ''),
    coalesce(elem->>'origin', 'manual'),
    nullif(elem->>'confidence', '')::numeric,
    coalesce((elem->>'is_included')::boolean, true),
    case when jsonb_typeof(elem->'source_ref') = 'object' then elem->'source_ref' else null end,
    coalesce((elem->>'sort_order')::int, 0)
  from jsonb_array_elements(p_items) as elem;
end; $$;

-- ── 3. SELECT 정책 축소 (작업영역은 본인+executive만) ──
-- 138의 부서장 가시성(my_readable_dept_ids) 제거 — 미확정 초안이 상사에게 보이지 않게.
drop policy if exists wri_select on weekly_report_items;
create policy wri_select on weekly_report_items
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_executive())
);
