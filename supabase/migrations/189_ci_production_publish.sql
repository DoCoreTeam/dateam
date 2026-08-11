-- 189_ci_production_publish.sql
-- 제작(아이디어·기획안·편집안·자료) · 게시
-- 설계: 01-db-schema.md §8~9

begin;

-- ── 아이디어 (파이프라인 보드) ──────────────────────────────────
create table if not exists ci_ideas (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references ci_workspaces(id) on delete cascade,
  topic_id         uuid references ci_topics(id) on delete set null,
  title            text not null,
  note             text,
  stage            ci_pipeline_stage not null default 'idea',
  assignee_id      uuid references profiles(id),
  target_platforms ci_platform[] not null default '{}',
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  archived_at      timestamptz
);
create index if not exists idx_ci_ideas_board
  on ci_ideas (workspace_id, stage, stage_changed_at desc) where archived_at is null;

-- stage 변경 시 경과일 기준 시각 자동 갱신
create or replace function ci_ideas_touch_stage()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_ci_ideas_stage on ci_ideas;
create trigger trg_ci_ideas_stage before update on ci_ideas
  for each row execute function ci_ideas_touch_stage();

-- 빵부스러기(근거 배지). 다형 참조.
create table if not exists ci_idea_evidence (
  idea_id     uuid not null references ci_ideas(id) on delete cascade,
  source_type text not null check (source_type in ('content','pattern','signal')),
  source_id   uuid not null,
  primary key (idea_id, source_type, source_id)
);

-- ── 기획안 ──────────────────────────────────────────────────────
create table if not exists ci_briefs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references ci_workspaces(id) on delete cascade,
  idea_id         uuid not null references ci_ideas(id) on delete cascade,
  version         integer not null default 1,
  parent_brief_id uuid references ci_briefs(id) on delete set null,
  platform        ci_platform,                    -- null이면 플랫폼 공통
  title_options   jsonb not null default '[]',
  hook            text,
  script          text,
  caption         text,
  thumbnail_specs jsonb not null default '{}',
  tags            text[] not null default '{}',
  status          text not null default 'draft' check (status in ('draft','ready')),
  generated_by    text check (generated_by in ('ai','user')),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
-- enum::text 캐스트는 IMMUTABLE이 아니라 인덱스 표현식에 쓸 수 없다.
-- NULLS NOT DISTINCT(PG15+)로 "플랫폼 공통(null)" 행도 중복을 막는다.
create unique index if not exists uq_ci_briefs_version
  on ci_briefs (idea_id, version, platform) nulls not distinct;
create index if not exists idx_ci_briefs_idea on ci_briefs (idea_id, version desc);

-- ── 편집안 ──────────────────────────────────────────────────────
create table if not exists ci_edit_plans (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references ci_workspaces(id) on delete cascade,
  brief_id      uuid not null references ci_briefs(id) on delete cascade,
  variant_label text,
  timecodes     jsonb not null default '[]',
  export_status text not null default 'none' check (export_status in ('none','requested','done','failed')),
  export_path   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ci_edit_plans_brief on ci_edit_plans (brief_id);

-- ── 자료 ────────────────────────────────────────────────────────
create table if not exists ci_assets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  brief_id     uuid references ci_briefs(id) on delete set null,
  kind         text not null check (kind in ('source','output')),
  storage_path text not null,                     -- Supabase Storage 버킷 ci-assets
  mime         text,
  bytes        bigint,
  checksum     text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_ci_assets_ws
  on ci_assets (workspace_id, created_at desc) where deleted_at is null;

-- ── 게시 ────────────────────────────────────────────────────────
create table if not exists ci_publications (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references ci_workspaces(id) on delete cascade,
  brief_id            uuid references ci_briefs(id) on delete set null,
  channel_id          uuid references ci_channels(id) on delete set null,
  platform            ci_platform not null,
  route               ci_publish_route not null default 'manual',
  status              ci_publish_status not null default 'draft',
  scheduled_at        timestamptz,
  published_at        timestamptz,
  published_url       text,
  external_content_id text,
  tracked_content_id  uuid references ci_contents(id) on delete set null,  -- 루프를 닫는 연결
  checklist           jsonb not null default '{}',
  spec_check          jsonb not null default '{}',
  error_code          text,
  error_message       text,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_ci_publications_calendar
  on ci_publications (workspace_id, coalesce(published_at, scheduled_at) desc);
create index if not exists idx_ci_publications_ready
  on ci_publications (workspace_id, status) where status in ('draft','scheduled');

-- 게시 대상 채널은 반드시 내 채널(ownership='owned')이어야 한다
create or replace function ci_publications_check_channel()
returns trigger language plpgsql as $$
begin
  if new.channel_id is not null then
    if not exists (
      select 1 from ci_channels c
      where c.id = new.channel_id and c.ownership = 'owned' and c.deleted_at is null
    ) then
      raise exception 'ci_publications.channel_id must reference an owned channel';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ci_publications_channel on ci_publications;
create trigger trg_ci_publications_channel
  before insert or update of channel_id on ci_publications
  for each row execute function ci_publications_check_channel();

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_ideas         enable row level security;
alter table ci_idea_evidence enable row level security;
alter table ci_briefs        enable row level security;
alter table ci_edit_plans    enable row level security;
alter table ci_assets        enable row level security;
alter table ci_publications  enable row level security;

drop policy if exists ci_ideas_rw on ci_ideas;
create policy ci_ideas_rw on ci_ideas for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_idea_evidence_rw on ci_idea_evidence;
create policy ci_idea_evidence_rw on ci_idea_evidence for all
  using (exists (select 1 from ci_ideas i
                 where i.id = idea_id and ci_is_member(i.workspace_id)))
  with check (exists (select 1 from ci_ideas i
                      where i.id = idea_id and ci_can_write(i.workspace_id)));

drop policy if exists ci_briefs_rw on ci_briefs;
create policy ci_briefs_rw on ci_briefs for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_edit_plans_rw on ci_edit_plans;
create policy ci_edit_plans_rw on ci_edit_plans for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_assets_rw on ci_assets;
create policy ci_assets_rw on ci_assets for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_publications_rw on ci_publications;
create policy ci_publications_rw on ci_publications for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

commit;
