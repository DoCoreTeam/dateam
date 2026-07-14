-- 149_org_weekly_reports.sql
-- 전체/개인/부서필터 AI 취합본 영구 저장 (Engine A 영속화)
-- 배경: api/reports/preview 가 Gemini 취합 결과를 JSON 반환만 → sessionStorage 에만 남아
--       세션 소멸 시 매번 재취합. dept_weekly_reports(부서 취합)만 영속되던 문제를 해소.
-- scope_key: 'all'(전체) | 'member:<user_id>'(개인) | 'dept:<sha1(sorted uids)>'(부서필터)

create table if not exists org_weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  scope_key   text not null,
  week_start  date not null check (extract(dow from week_start) = 1),
  body        jsonb not null default '[]'::jsonb,   -- category별 취합 본문(편집 반영)
  source_hash text,                                  -- 원본 weekly_reports 기준 해시(재취합 필요 감지)
  edited_by   uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (scope_key, week_start)
);
create index if not exists idx_owr_scope_week on org_weekly_reports (scope_key, week_start);

alter table org_weekly_reports enable row level security;

-- Engine A는 라우트에서 role=admin 강제. RLS도 admin 전용 read/write (default-deny).
-- (서버 서비스롤은 RLS 우회하여 write; 아래 정책은 방어적 이중화)
drop policy if exists owr_admin_all on org_weekly_reports;
create policy owr_admin_all on org_weekly_reports
for all to authenticated
using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null))
with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null));

create or replace function fn_owr_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_owr_touch on org_weekly_reports;
create trigger trg_owr_touch before update on org_weekly_reports
for each row execute function fn_owr_touch();
