-- 157_ai_analysis_sessions.sql
-- 목록 심층분석(/ai-chat/analyze) 영속 저장 — 세션(추출 자료)+항목(분석결과) 유실0.
-- RLS는 150_ai_chat.sql의 ai_conversations/ai_messages(admin+owner) 패턴 재사용 —
-- 이 기능도 requireAdminApi 게이트(admin 전용)이므로 동일 정합.

create table if not exists ai_analysis_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null default '목록 심층분석',
  source_text text not null default '',
  lens        text not null default 'summary',
  source_kind text not null default 'text',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_aias_user_recent
  on ai_analysis_sessions (user_id, updated_at desc)
  where deleted_at is null;

create table if not exists ai_analysis_items (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references ai_analysis_sessions(id) on delete cascade,
  idx         integer not null,
  item_text   text not null,
  status      text not null default 'pending' check (status in ('pending','running','done','error')),
  result_text text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, idx)
);
create index if not exists idx_aiai_session on ai_analysis_items (session_id, idx);

alter table ai_analysis_sessions enable row level security;
alter table ai_analysis_items enable row level security;

drop policy if exists aias_admin_owner on ai_analysis_sessions;
create policy aias_admin_owner on ai_analysis_sessions
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
);

drop policy if exists aiai_admin_owner on ai_analysis_items;
create policy aiai_admin_owner on ai_analysis_items
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_analysis_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_analysis_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);

create or replace function fn_aias_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aias_touch on ai_analysis_sessions;
create trigger trg_aias_touch before update on ai_analysis_sessions
for each row execute function fn_aias_touch();

create or replace function fn_aiai_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aiai_touch on ai_analysis_items;
create trigger trg_aiai_touch before update on ai_analysis_items
for each row execute function fn_aiai_touch();

-- 항목 갱신 시 부모 세션 updated_at 갱신(최근 세션 정렬 소스, 150 fn_aicm_touch_conv 패턴)
create or replace function fn_aiai_touch_session() returns trigger language plpgsql as $$
begin
  update ai_analysis_sessions set updated_at = now() where id = new.session_id;
  return new;
end; $$;
drop trigger if exists trg_aiai_touch_session on ai_analysis_items;
create trigger trg_aiai_touch_session after insert or update on ai_analysis_items
for each row execute function fn_aiai_touch_session();
