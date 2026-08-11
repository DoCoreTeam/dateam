-- 186_ci_taxonomy_channels.sql
-- 주제 · 플랫폼 프로필 · 채널 · 채널 연결
-- 설계: 01-db-schema.md §4~5

begin;

-- ── 주제 ────────────────────────────────────────────────────────
create table if not exists ci_topics (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references ci_workspaces(id) on delete cascade,
  name           text not null,
  slug           text not null,
  parent_id      uuid references ci_topics(id) on delete set null,
  description    text,
  merged_into_id uuid references ci_topics(id) on delete set null,  -- 병합 이력 보존
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index if not exists uq_ci_topics_slug
  on ci_topics (workspace_id, slug) where deleted_at is null;
create index if not exists idx_ci_topics_ws on ci_topics (workspace_id) where deleted_at is null;

-- 184에서 미뤄둔 FK (순환 참조 회피)
do $$ begin
  alter table ci_workspaces
    add constraint ci_workspaces_default_topic_fk
    foreign key (default_topic_id) references ci_topics(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists ci_topic_rules (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references ci_topics(id) on delete cascade,
  kind       text not null check (kind in ('include','exclude')),
  pattern    text not null,
  origin     text not null default 'user' check (origin in ('user','promoted')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ci_topic_rules_topic on ci_topic_rules (topic_id);

-- ── 플랫폼 프로필 (system 스코프) ───────────────────────────────
create table if not exists ci_platform_profiles (
  platform             ci_platform primary key,
  display_name         text not null,
  metric_definitions   jsonb not null default '{}',   -- 플랫폼별 조회수 정의 원문
  required_fields      text[] not null default '{}',  -- completeness 분모
  comparability_class  ci_comparability not null default 'B',
  supports_api_publish boolean not null default false,
  ingest_methods       jsonb not null default '[]',   -- 방법 체인 순서
  regression_urls      text[] not null default '{}',
  health               jsonb not null default '{}',
  updated_by           uuid references profiles(id),
  updated_at           timestamptz not null default now()
);

insert into ci_platform_profiles
  (platform, display_name, comparability_class, supports_api_publish, ingest_methods, required_fields)
values
  ('youtube',  'YouTube',   'A', true,
   '["official_api","oembed","meta_tags"]',
   '{title,published_at,views,likes,comments,thumbnail_url,duration_sec}'),
  ('tiktok',   'TikTok',    'B', false,
   '["oembed","meta_tags","render"]',
   '{title,published_at,views,likes,comments,thumbnail_url}'),
  ('instagram','Instagram', 'B', false,
   '["official_api","oembed","meta_tags","render"]',
   '{caption,published_at,likes,comments,thumbnail_url}'),
  ('facebook', 'Facebook',  'B', false,
   '["official_api","meta_tags","render"]',
   '{caption,published_at,likes,comments}'),
  ('x',        'X',         'C', false,
   '["meta_tags","render"]',
   '{caption,published_at,likes,comments}'),
  ('threads',  'Threads',   'C', false,
   '["meta_tags","render"]',
   '{caption,published_at,likes,comments}')
on conflict (platform) do nothing;

-- ── 채널 ────────────────────────────────────────────────────────
create table if not exists ci_channels (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references ci_workspaces(id) on delete cascade,
  platform              ci_platform not null,
  external_id           text not null,
  handle                text,
  display_name          text not null,
  profile_url           text,
  avatar_url            text,
  subscriber_count      bigint,
  subscriber_provenance text check (subscriber_provenance in ('platform','web_verified','estimated')),
  ownership             ci_channel_ownership not null default 'tracked',
  is_monitored          boolean not null default false,
  monitored_since       timestamptz,
  size_band             text,
  topic_id              uuid references ci_topics(id) on delete set null,
  last_seen_at          timestamptz,
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create unique index if not exists uq_ci_channels_ext
  on ci_channels (workspace_id, platform, external_id) where deleted_at is null;
create index if not exists idx_ci_channels_monitored
  on ci_channels (workspace_id, is_monitored) where deleted_at is null;
create index if not exists idx_ci_channels_owned
  on ci_channels (workspace_id, ownership) where deleted_at is null;

-- 플랫폼 간 동일 채널 (확정은 항상 사용자)
create table if not exists ci_channel_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  channel_a_id uuid not null references ci_channels(id) on delete cascade,
  channel_b_id uuid not null references ci_channels(id) on delete cascade,
  confidence   numeric(4,3),
  status       text not null default 'suggested' check (status in ('suggested','confirmed','rejected')),
  evidence     jsonb not null default '{}',
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint ci_channel_links_distinct check (channel_a_id <> channel_b_id)
);
create unique index if not exists uq_ci_channel_links_pair
  on ci_channel_links (workspace_id,
                       least(channel_a_id, channel_b_id),
                       greatest(channel_a_id, channel_b_id));

-- 내 채널 OAuth 연결 (토큰은 암호화 bytea. 평문 text 컬럼 금지)
create table if not exists ci_channel_connections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references ci_workspaces(id) on delete cascade,
  channel_id        uuid not null references ci_channels(id) on delete cascade,
  platform          ci_platform not null,
  access_token_enc  bytea,
  refresh_token_enc bytea,
  scopes            text[] not null default '{}',
  expires_at        timestamptz,
  status            text not null default 'connected'
                    check (status in ('connected','expired','revoked','error')),
  last_error        text,
  connected_by      uuid references profiles(id),
  connected_at      timestamptz not null default now(),
  last_refreshed_at timestamptz
);
create unique index if not exists uq_ci_connections_channel
  on ci_channel_connections (workspace_id, channel_id);

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_topics               enable row level security;
alter table ci_topic_rules          enable row level security;
alter table ci_platform_profiles    enable row level security;
alter table ci_channels             enable row level security;
alter table ci_channel_links        enable row level security;
alter table ci_channel_connections  enable row level security;

drop policy if exists ci_topics_rw on ci_topics;
create policy ci_topics_rw on ci_topics for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_topic_rules_rw on ci_topic_rules;
create policy ci_topic_rules_rw on ci_topic_rules for all
  using (exists (select 1 from ci_topics t
                 where t.id = topic_id and ci_is_member(t.workspace_id)))
  with check (exists (select 1 from ci_topics t
                      where t.id = topic_id and ci_can_admin(t.workspace_id)));

drop policy if exists ci_platform_profiles_select on ci_platform_profiles;
create policy ci_platform_profiles_select on ci_platform_profiles
  for select using (auth.uid() is not null);
drop policy if exists ci_platform_profiles_write on ci_platform_profiles;
create policy ci_platform_profiles_write on ci_platform_profiles
  for all using (ci_is_app_admin()) with check (ci_is_app_admin());

drop policy if exists ci_channels_rw on ci_channels;
create policy ci_channels_rw on ci_channels for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_channel_links_rw on ci_channel_links;
create policy ci_channel_links_rw on ci_channel_links for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

-- 연결 토큰은 admin만 접근 (viewer/member 노출 금지)
drop policy if exists ci_connections_rw on ci_channel_connections;
create policy ci_connections_rw on ci_channel_connections for all
  using (ci_can_admin(workspace_id)) with check (ci_can_admin(workspace_id));

commit;
