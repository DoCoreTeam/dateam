-- 048_dept_weekly_reports.sql
-- Phase 3 — 부서 취합 스냅샷 + 감사로그 (계층 권한 RLS)
-- 부서장이 부서원 원본을 취합 → dept_weekly_reports 스냅샷(편집/확정). 상위/전사는 조회.

-- ── 1. 부서 취합 스냅샷 ──
create table if not exists dept_weekly_reports (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references org_nodes(id) on delete cascade,
  week_start    date not null check (extract(dow from week_start) = 1),
  body          jsonb not null default '[]'::jsonb,   -- category별 취합 본문(부서장 편집)
  source_hash   text,                                  -- 원본 N건 기준 해시(재취합 필요 감지)
  status        text not null default 'draft' check (status in ('draft','confirmed')),
  edited_by     uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (department_id, week_start)
);
create index if not exists idx_dwr_dept_week on dept_weekly_reports (department_id, week_start);

alter table dept_weekly_reports enable row level security;

-- SELECT: 관할 부서(자기+하위) OR 전사
drop policy if exists dwr_select on dept_weekly_reports;
create policy dwr_select on dept_weekly_reports
for select to authenticated
using (
  department_id = any(private.my_readable_dept_ids())
  or (select private.is_executive())
);

-- INSERT/UPDATE/DELETE: 직접 관할(자기 부서)만 → 하위부서는 조회전용 강제
drop policy if exists dwr_write on dept_weekly_reports;
create policy dwr_write on dept_weekly_reports
for all to authenticated
using (department_id = any(private.my_editable_dept_ids()))
with check (department_id = any(private.my_editable_dept_ids()));

-- updated_at 자동 갱신
create or replace function fn_dwr_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_dwr_touch on dept_weekly_reports;
create trigger trg_dwr_touch before update on dept_weekly_reports
for each row execute function fn_dwr_touch();

-- ── 2. 감사 로그 (상위/전사의 하위 보고서 열람 기록) ──
create table if not exists report_access_log (
  id          uuid primary key default gen_random_uuid(),
  viewer_id   uuid references profiles(id),
  target_kind text not null check (target_kind in ('weekly_report','dept_weekly_report')),
  target_id   uuid,
  department_id uuid references org_nodes(id),
  accessed_at timestamptz not null default now()
);
create index if not exists idx_ral_dept on report_access_log (department_id, accessed_at);

alter table report_access_log enable row level security;
-- 본인 기록 INSERT만 허용, SELECT는 admin (감사용)
drop policy if exists ral_insert on report_access_log;
create policy ral_insert on report_access_log
for insert to authenticated
with check (viewer_id = (select auth.uid()));
drop policy if exists ral_admin_select on report_access_log;
create policy ral_admin_select on report_access_log
for select to authenticated
using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null));
