-- 184_ci_enums_and_workspace.sql
-- 콘텐츠 인텔리전스(CI) — ENUM 전수 + 워크스페이스/멤버/초대 + RLS 헬퍼
-- 설계: docs/2026-08-11-v0.5.0-content-intelligence-schema/01-db-schema.md §1~2
-- 기존 테이블은 한 줄도 수정하지 않는다. CI는 순수 추가분이다.

begin;

-- ── 1. ENUM 17종 ────────────────────────────────────────────────
-- 각 타입을 개별 블록으로 생성한다. 하나의 블록에 모으면 이미 존재하는 타입에서
-- 예외가 발생해 이후 create가 통째로 건너뛰어져, 부분 재실행 시 조용히 누락된다.
do $$ declare t text; d text; begin
  foreach t in array array[
    'ci_member_role',       'ci_setting_scope',   'ci_platform',
    'ci_content_format',    'ci_channel_ownership','ci_ingest_status',
    'ci_content_source',    'ci_review_state',    'ci_comparability',
    'ci_confidence',        'ci_topic_source',    'ci_pipeline_stage',
    'ci_publish_route',     'ci_publish_status',  'ci_job_stage',
    'ci_job_status',        'ci_correction_kind'
  ] loop
    d := case t
      when 'ci_member_role'       then $v$'owner','admin','member','viewer'$v$
      when 'ci_setting_scope'     then $v$'system','workspace','user'$v$
      when 'ci_platform'          then $v$'youtube','tiktok','instagram','facebook','x','threads'$v$
      when 'ci_content_format'    then $v$'short','long','image','text','live'$v$
      when 'ci_channel_ownership' then $v$'owned','tracked'$v$
      when 'ci_ingest_status'     then $v$'queued','running','done','partial','failed'$v$
      when 'ci_content_source'    then $v$'inbox','monitoring'$v$
      when 'ci_review_state'      then $v$'none','pending','resolved'$v$
      when 'ci_comparability'     then $v$'A','B','C'$v$
      when 'ci_confidence'        then $v$'high','medium','insufficient'$v$
      when 'ci_topic_source'      then $v$'auto','ai_verified','user'$v$
      when 'ci_pipeline_stage'    then $v$'idea','brief','edit','ready'$v$
      when 'ci_publish_route'     then $v$'manual','api'$v$
      when 'ci_publish_status'    then $v$'draft','scheduled','exported','published','failed'$v$
      when 'ci_job_stage'         then $v$'ingest','normalize','enrich','classify','verify','project'$v$
      when 'ci_job_status'        then $v$'queued','running','succeeded','failed','dead'$v$
      when 'ci_correction_kind'   then $v$'topic','group_unlink','outlier_dismiss','channel_link','field_fix'$v$
    end;
    if not exists (select 1 from pg_type where typname = t) then
      execute format('create type %I as enum (%s)', t, d);
    end if;
  end loop;
end $$;

-- ── 2. 워크스페이스 ─────────────────────────────────────────────
create table if not exists ci_workspaces (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null,
  logo_url         text,
  default_locale   text not null default 'ko',
  default_timezone text not null default 'Asia/Seoul',
  default_topic_id uuid,                              -- FK는 186에서 부여(순환 회피)
  owner_id         uuid not null references profiles(id),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  purge_after      timestamptz
);
create unique index if not exists uq_ci_workspaces_slug
  on ci_workspaces (slug) where deleted_at is null;
create index if not exists idx_ci_workspaces_owner
  on ci_workspaces (owner_id) where deleted_at is null;

create table if not exists ci_workspace_members (
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         ci_member_role not null default 'member',
  invited_by   uuid references profiles(id),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists idx_ci_members_user on ci_workspace_members (user_id);

-- 워크스페이스당 owner 정확히 1명 (부분 유니크 인덱스로 강제)
create unique index if not exists uq_ci_members_single_owner
  on ci_workspace_members (workspace_id) where role = 'owner';

create table if not exists ci_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  email        text not null,
  role         ci_member_role not null default 'member',
  token_hash   text not null unique,                  -- 원문 토큰 저장 금지
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  invited_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_ci_invitations_pending
  on ci_invitations (workspace_id, lower(email)) where accepted_at is null;

-- ── 3. RLS 헬퍼 ─────────────────────────────────────────────────
create or replace function ci_is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ci_workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function ci_role(ws uuid)
returns ci_member_role language sql stable security definer set search_path = public as $$
  select role from ci_workspace_members
  where workspace_id = ws and user_id = auth.uid();
$$;

-- 쓰기 가능 여부: viewer 제외
create or replace function ci_can_write(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ci_role(ws) <> 'viewer', false);
$$;

-- 관리 가능 여부: owner/admin
create or replace function ci_can_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ci_role(ws) in ('owner','admin'), false);
$$;

-- 앱 전체 관리자 (기존 profiles.role 재사용)
create or replace function ci_is_app_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- ── 4. RLS ──────────────────────────────────────────────────────
alter table ci_workspaces         enable row level security;
alter table ci_workspace_members  enable row level security;
alter table ci_invitations        enable row level security;

drop policy if exists ci_workspaces_select on ci_workspaces;
create policy ci_workspaces_select on ci_workspaces
  for select using (ci_is_member(id));

drop policy if exists ci_workspaces_insert on ci_workspaces;
create policy ci_workspaces_insert on ci_workspaces
  for insert with check (owner_id = auth.uid());

drop policy if exists ci_workspaces_update on ci_workspaces;
create policy ci_workspaces_update on ci_workspaces
  for update using (ci_can_admin(id)) with check (ci_can_admin(id));

-- 물리 삭제는 막고 소프트 삭제(update)만 허용 — 유예 삭제 정책
drop policy if exists ci_workspaces_delete on ci_workspaces;

drop policy if exists ci_members_select on ci_workspace_members;
create policy ci_members_select on ci_workspace_members
  for select using (ci_is_member(workspace_id));

drop policy if exists ci_members_write on ci_workspace_members;
create policy ci_members_write on ci_workspace_members
  for insert with check (ci_can_admin(workspace_id));

drop policy if exists ci_members_update on ci_workspace_members;
create policy ci_members_update on ci_workspace_members
  for update using (ci_can_admin(workspace_id)) with check (ci_can_admin(workspace_id));

-- owner 행은 삭제 불가 (소유권 이양으로만 변경)
drop policy if exists ci_members_delete on ci_workspace_members;
create policy ci_members_delete on ci_workspace_members
  for delete using (ci_can_admin(workspace_id) and role <> 'owner');

drop policy if exists ci_invitations_select on ci_invitations;
create policy ci_invitations_select on ci_invitations
  for select using (ci_is_member(workspace_id));

drop policy if exists ci_invitations_write on ci_invitations;
create policy ci_invitations_write on ci_invitations
  for all using (ci_can_admin(workspace_id)) with check (ci_can_admin(workspace_id));

commit;
