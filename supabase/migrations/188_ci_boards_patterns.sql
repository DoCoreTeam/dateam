-- 188_ci_boards_patterns.sql
-- 보드(발견물 저장함) · 성공 공식 · 이슈
-- 설계: 01-db-schema.md §7 / 설계서 §8.2

begin;

create table if not exists ci_boards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  name         text not null,
  topic_id     uuid references ci_topics(id) on delete set null,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_ci_boards_ws
  on ci_boards (workspace_id, created_at desc) where deleted_at is null;

-- 다형 참조(content/pattern/signal)라 FK를 걸 수 없다.
-- 원본 삭제 시 정합성은 project 단계 정리 잡이 담당한다.
create table if not exists ci_board_items (
  id        uuid primary key default gen_random_uuid(),
  board_id  uuid not null references ci_boards(id) on delete cascade,
  item_type text not null check (item_type in ('content','pattern','signal')),
  item_id   uuid not null,
  note      text,
  added_by  uuid references profiles(id),
  added_at  timestamptz not null default now()
);
create unique index if not exists uq_ci_board_items
  on ci_board_items (board_id, item_type, item_id);
create index if not exists idx_ci_board_items_lookup
  on ci_board_items (item_type, item_id);

-- ── 성공 공식 ───────────────────────────────────────────────────
-- 표기 불변조건: lift는 evidence_count·channel_count 병기 없이 렌더 금지 (설계서 §4.3)
-- 승격 기준: evidence_count >= 20 and channel_count >= 5 (lib/ci/patterns.ts에서 강제)
create table if not exists ci_patterns (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references ci_workspaces(id) on delete cascade,
  topic_id        uuid references ci_topics(id) on delete set null,
  kind            text not null check (kind in ('title','hook','thumbnail','structure','timing')),
  statement       text not null,                 -- 화면에 그대로 노출되는 한 문장
  lift            numeric(6,2),
  evidence_count  integer not null default 0,
  channel_count   integer not null default 0,
  confidence      ci_confidence not null default 'insufficient',
  computed_at     timestamptz not null default now(),
  is_archived     boolean not null default false
);
create index if not exists idx_ci_patterns_topic
  on ci_patterns (workspace_id, topic_id, lift desc) where is_archived = false;

create table if not exists ci_pattern_evidence (
  pattern_id uuid not null references ci_patterns(id) on delete cascade,
  content_id uuid not null references ci_contents(id) on delete cascade,
  weight     numeric(6,3),
  primary key (pattern_id, content_id)
);

-- ── 이슈(외부 신호) ─────────────────────────────────────────────
create table if not exists ci_signals (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  topic_id     uuid references ci_topics(id) on delete set null,
  kind         text not null check (kind in ('news','search_spike','community')),
  title        text not null,
  url          text,
  source       text,
  occurred_at  timestamptz,
  score        numeric(8,3),
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists idx_ci_signals_topic_time
  on ci_signals (workspace_id, topic_id, occurred_at desc);

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_boards            enable row level security;
alter table ci_board_items       enable row level security;
alter table ci_patterns          enable row level security;
alter table ci_pattern_evidence  enable row level security;
alter table ci_signals           enable row level security;

drop policy if exists ci_boards_rw on ci_boards;
create policy ci_boards_rw on ci_boards for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_board_items_rw on ci_board_items;
create policy ci_board_items_rw on ci_board_items for all
  using (exists (select 1 from ci_boards b
                 where b.id = board_id and ci_is_member(b.workspace_id)))
  with check (exists (select 1 from ci_boards b
                      where b.id = board_id and ci_can_write(b.workspace_id)));

-- 공식은 계산 산출물. 사용자는 읽기와 보관(archive)만, 생성은 워커가 한다.
drop policy if exists ci_patterns_select on ci_patterns;
create policy ci_patterns_select on ci_patterns for select
  using (ci_is_member(workspace_id));
drop policy if exists ci_patterns_update on ci_patterns;
create policy ci_patterns_update on ci_patterns for update
  using (ci_can_write(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_pattern_evidence_select on ci_pattern_evidence;
create policy ci_pattern_evidence_select on ci_pattern_evidence for select
  using (exists (select 1 from ci_patterns p
                 where p.id = pattern_id and ci_is_member(p.workspace_id)));

drop policy if exists ci_signals_select on ci_signals;
create policy ci_signals_select on ci_signals for select
  using (ci_is_member(workspace_id));

commit;
