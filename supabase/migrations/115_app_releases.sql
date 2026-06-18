-- 115_app_releases.sql — 앱 업데이트 내역(체인지로그) SSOT.
-- 버전 클릭 시 공개 모달이 게시분(is_published)만 읽고, 어드민이 CRUD·게시토글·git 가져오기로 관리.

create table if not exists public.app_releases (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,                      -- 예: '0.7.196'
  released_at   date,                                      -- 표시 날짜
  title         text,                                      -- 한 줄 요약
  changes       jsonb not null default '[]'::jsonb,        -- [{ "text": "...", "type": "feature|fix|improve" }]
  type          text not null default 'feature' check (type in ('feature','fix','improve')),
  is_published  boolean not null default false,            -- 초안(false) / 게시(true)
  sort_order    integer,                                   -- 수동 정렬(없으면 version desc)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.app_releases is '앱 버전별 업데이트 내역(체인지로그). 게시분만 사용자 공개.';

create index if not exists app_releases_published_idx on public.app_releases (is_published, released_at desc);
create index if not exists app_releases_version_idx   on public.app_releases (version);

-- updated_at 자동 갱신
create or replace function public.app_releases_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists app_releases_touch on public.app_releases;
create trigger app_releases_touch before update on public.app_releases
  for each row execute function public.app_releases_touch_updated_at();

-- RLS (default-deny) — admin 전체 / 멤버는 게시분 읽기만
alter table public.app_releases enable row level security;

drop policy if exists app_releases_admin_all on public.app_releases;
create policy app_releases_admin_all on public.app_releases
  for all
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null));

drop policy if exists app_releases_member_read_published on public.app_releases;
create policy app_releases_member_read_published on public.app_releases
  for select
  using (is_published = true);
