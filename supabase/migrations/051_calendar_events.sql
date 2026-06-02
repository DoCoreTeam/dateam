-- 051_calendar_events.sql
-- P1 — 캘린더 일정 테이블 (가산적). 조직 계층 RLS는 기존 private 헬퍼 재사용.
-- 업무 연계(link_kind/link_id)는 소프트 링크 — daily_logs/weekly_reports/memo 연결(P2에서 UI).

create table if not exists calendar_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  department_id uuid references org_nodes(id),
  title         text not null,
  description   text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  all_day       boolean not null default false,
  rrule         text,                                  -- 반복(P4)
  source        text not null default 'user' check (source in ('user','ai','rule')),
  link_kind     text check (link_kind in ('daily','weekly','memo')),
  link_id       uuid,
  status        text not null default 'scheduled' check (status in ('scheduled','done','canceled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cal_user_start on calendar_events (user_id, start_at);
create index if not exists idx_cal_dept_start on calendar_events (department_id, start_at);
create index if not exists idx_cal_link on calendar_events (link_kind, link_id);

create or replace function fn_cal_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_cal_touch on calendar_events;
create trigger trg_cal_touch before update on calendar_events
for each row execute function fn_cal_touch();

alter table calendar_events enable row level security;

-- SELECT: 본인 OR admin OR (플래그 ON: 관할 팀원 OR 전사) — daily_logs와 동일 패턴, 기존 헬퍼 재사용
drop policy if exists cal_select on calendar_events;
create policy cal_select on calendar_events for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  or (
    (select private.hierarchy_enabled())
    and ( user_id = any(private.my_readable_user_ids()) or (select private.is_executive()) )
  )
);

-- INSERT/UPDATE/DELETE: 본인만
drop policy if exists cal_write on calendar_events;
create policy cal_write on calendar_events for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
