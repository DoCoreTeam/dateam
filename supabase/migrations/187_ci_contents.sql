-- 187_ci_contents.sql
-- UCM 실체: 콘텐츠 · 지표 시계열 · 계산 캐시 · 같은 소재 묶음
-- 설계: 01-db-schema.md §6
-- 불변조건: source='inbox' 행은 통계 모집단에서 제외한다 (설계서 §7.3)

begin;

create table if not exists ci_content_groups (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references ci_workspaces(id) on delete cascade,
  representative_content_id uuid,                    -- FK는 ci_contents 생성 후 부여
  method                    text not null check (method in ('fingerprint','ai_similarity')),
  confidence                numeric(4,3),
  created_at                timestamptz not null default now()
);

create table if not exists ci_contents (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references ci_workspaces(id) on delete cascade,
  platform            ci_platform not null,
  external_id         text not null,
  canonical_url       text not null,
  channel_id          uuid references ci_channels(id) on delete set null,
  format              ci_content_format not null,
  title               text,
  caption             text,                          -- plain text. HTML은 html-to-plain 경유
  published_at        timestamptz,
  duration_sec        integer,
  language            text,
  thumbnail_url       text,
  media_fingerprint   text,
  topic_id            uuid references ci_topics(id) on delete set null,
  topic_confidence    numeric(4,3),
  topic_source        ci_topic_source not null default 'auto',
  ingest_status       ci_ingest_status not null default 'queued',
  completeness        numeric(4,3) not null default 0,
  missing_fields      text[] not null default '{}',
  comparability_class ci_comparability,
  content_group_id    uuid references ci_content_groups(id) on delete set null,
  source              ci_content_source not null,
  review_state        ci_review_state not null default 'none',
  is_stat_excluded    boolean not null default false,
  deleted_detected_at timestamptz,
  provenance          jsonb not null default '{}',
  first_seen_at       timestamptz not null default now(),
  last_refreshed_at   timestamptz,
  created_by          uuid references profiles(id),
  deleted_at          timestamptz
);

do $$ begin
  alter table ci_content_groups
    add constraint ci_content_groups_rep_fk
    foreign key (representative_content_id) references ci_contents(id) on delete set null;
exception when duplicate_object then null;
end $$;

create unique index if not exists uq_ci_contents_ext
  on ci_contents (workspace_id, platform, external_id) where deleted_at is null;

-- 트렌드/떡상 주 쿼리 경로. CORPUS_FILTER(lib/ci/corpus.ts)와 1:1로 대응한다.
create index if not exists idx_ci_contents_corpus
  on ci_contents (workspace_id, topic_id, format, published_at desc)
  where source = 'monitoring' and is_stat_excluded = false and deleted_at is null;

create index if not exists idx_ci_contents_review
  on ci_contents (workspace_id, review_state, first_seen_at desc) where deleted_at is null;
create index if not exists idx_ci_contents_status
  on ci_contents (workspace_id, ingest_status, first_seen_at desc) where deleted_at is null;
create index if not exists idx_ci_contents_channel
  on ci_contents (channel_id, published_at desc);
create index if not exists idx_ci_contents_fingerprint
  on ci_contents (workspace_id, media_fingerprint) where media_fingerprint is not null;
create index if not exists idx_ci_contents_group
  on ci_contents (content_group_id) where content_group_id is not null;

-- ── 지표 시계열 (append-only) ───────────────────────────────────
create table if not exists ci_content_metrics (
  content_id    uuid not null references ci_contents(id) on delete cascade,
  captured_at   timestamptz not null,
  views         bigint,
  likes         bigint,
  comments      bigint,
  shares        bigint,
  saves         bigint,
  source_method text,
  is_estimated  boolean not null default false,
  primary key (content_id, captured_at)
);
create index if not exists idx_ci_metrics_content_time
  on ci_content_metrics (content_id, captured_at desc);

-- ── 계산 캐시 ───────────────────────────────────────────────────
create table if not exists ci_content_derived (
  content_id         uuid primary key references ci_contents(id) on delete cascade,
  outlier_index      numeric(8,2),
  outlier_baseline_n integer not null default 0,   -- 8 미만이면 화면 미표시
  topic_percentile   numeric(5,2),
  velocity_per_hour  numeric(12,2),
  confidence         ci_confidence not null default 'insufficient',
  window_days        integer not null default 28,
  sample_json        jsonb not null default '{}',  -- EvidenceSheet 원천
  computed_at        timestamptz not null default now()
);
create index if not exists idx_ci_derived_outlier
  on ci_content_derived (outlier_index desc) where outlier_baseline_n >= 8;

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_contents        enable row level security;
alter table ci_content_groups  enable row level security;
alter table ci_content_metrics enable row level security;
alter table ci_content_derived enable row level security;

drop policy if exists ci_contents_rw on ci_contents;
create policy ci_contents_rw on ci_contents for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_content_groups_rw on ci_content_groups;
create policy ci_content_groups_rw on ci_content_groups for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

-- 지표·파생값은 워커(service_role)만 쓴다. 사용자에게는 읽기만 허용.
drop policy if exists ci_metrics_select on ci_content_metrics;
create policy ci_metrics_select on ci_content_metrics for select
  using (exists (select 1 from ci_contents c
                 where c.id = content_id and ci_is_member(c.workspace_id)));

drop policy if exists ci_derived_select on ci_content_derived;
create policy ci_derived_select on ci_content_derived for select
  using (exists (select 1 from ci_contents c
                 where c.id = content_id and ci_is_member(c.workspace_id)));

commit;
