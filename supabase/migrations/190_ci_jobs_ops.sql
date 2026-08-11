-- 190_ci_jobs_ops.sql
-- 잡 인프라 · 스냅샷 스케줄 · 정정 학습 · 알림 · 과금
-- 설계: 01-db-schema.md §10~11 / 설계서 §11.2 (1차 실패의 차단 장치)
-- 핵심: 모든 정리 작업은 비동기 잡. 재시도·실패 큐·상태 노출. 침묵 실패 금지.

begin;

-- ── 잡 ──────────────────────────────────────────────────────────
create table if not exists ci_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references ci_workspaces(id) on delete cascade,  -- 시스템 잡은 null
  stage           ci_job_stage not null,
  idempotency_key text not null,                  -- '{stage}:{target_id}:{version}'
  target_type     text not null,
  target_id       uuid,
  payload         jsonb not null default '{}',
  status          ci_job_status not null default 'queued',
  attempt         integer not null default 0,
  max_attempts    integer not null default 3,
  next_run_at     timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_ci_jobs_idem on ci_jobs (idempotency_key);
-- 워커 클레임 경로 (for update skip locked)
create index if not exists idx_ci_jobs_claim
  on ci_jobs (next_run_at) where status in ('queued','failed');
-- 실패 큐(DLQ) 화면
create index if not exists idx_ci_jobs_dlq
  on ci_jobs (workspace_id, stage, updated_at desc) where status = 'dead';

create table if not exists ci_job_runs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references ci_jobs(id) on delete cascade,
  attempt       integer not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        ci_job_status not null,
  error_code    text,
  error_message text,
  duration_ms   integer,
  tokens_used   integer,
  cost_krw      numeric(12,2)
);
create index if not exists idx_ci_job_runs_job on ci_job_runs (job_id, attempt);
create index if not exists idx_ci_job_runs_stats on ci_job_runs (started_at desc);

-- ── 스냅샷 스케줄 (비용 폭증 방어) ──────────────────────────────
create table if not exists ci_snapshot_schedules (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references ci_workspaces(id) on delete cascade,
  content_id     uuid not null references ci_contents(id) on delete cascade,
  next_capture_at timestamptz not null,
  interval_sec   integer not null,               -- 나이별 간격 정책이 갱신한다
  preset         text not null default 'standard' check (preset in ('economy','standard','precise')),
  stop_after     timestamptz,
  captures_done  integer not null default 0
);
create unique index if not exists uq_ci_snapshot_content
  on ci_snapshot_schedules (content_id);
-- now()는 IMMUTABLE이 아니라 인덱스 조건절에 쓸 수 없다.
-- 만료 필터는 워커 쿼리(where stop_after is null or stop_after > now())가 담당한다.
create index if not exists idx_ci_snapshot_due
  on ci_snapshot_schedules (next_capture_at, stop_after);

-- ── 정정 학습 루프 ──────────────────────────────────────────────
create table if not exists ci_corrections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references ci_workspaces(id) on delete cascade,
  kind             ci_correction_kind not null,
  target_type      text,
  target_id        uuid,
  before_value     jsonb,
  after_value      jsonb,
  actor_id         uuid references profiles(id),
  created_at       timestamptz not null default now(),
  promoted_rule_id uuid references ci_topic_rules(id) on delete set null
);
create index if not exists idx_ci_corrections_kind
  on ci_corrections (workspace_id, kind, created_at desc);

-- ── 알림 ────────────────────────────────────────────────────────
create table if not exists ci_alert_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  kind         text not null check (kind in ('outlier','daily_brief')),
  threshold    numeric(6,2) not null default 3,   -- 평소 대비 3배 (설계서 §8.1)
  scope_type   text not null default 'all' check (scope_type in ('all','topic','channel')),
  scope_id     uuid,
  delivery     text[] not null default '{push,email}',
  send_at      time,
  quiet_hours  jsonb not null default '{}',
  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ci_alert_rules_ws
  on ci_alert_rules (workspace_id) where is_enabled = true;

create table if not exists ci_notifications (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references ci_workspaces(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  rule_id         uuid references ci_alert_rules(id) on delete set null,
  content_id      uuid references ci_contents(id) on delete cascade,
  title           text not null,
  body            text,
  deeplink        text,
  sent_at         timestamptz not null default now(),
  read_at         timestamptz,
  delivery_result jsonb not null default '{}'
);
create index if not exists idx_ci_notifications_user
  on ci_notifications (user_id, sent_at desc);
-- 같은 콘텐츠 중복 알림 차단
create unique index if not exists uq_ci_notifications_dedup
  on ci_notifications (rule_id, content_id, user_id)
  where rule_id is not null and content_id is not null;

-- ── 과금 ────────────────────────────────────────────────────────
create table if not exists ci_plans (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  limits    jsonb not null default '{}',
  price_krw integer not null default 0,
  is_active boolean not null default true
);

insert into ci_plans (code, name, limits, price_krw) values
  ('free', '무료 체험',
   '{"tracked_channels":3,"ai_calls_per_day":20,"snapshot_preset":"economy","members":1,"refresh_per_day":1}', 0)
on conflict (code) do nothing;

create table if not exists ci_subscriptions (
  workspace_id         uuid primary key references ci_workspaces(id) on delete cascade,
  plan_id              uuid not null references ci_plans(id),
  status               text not null default 'trial' check (status in ('trial','active','past_due','canceled')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  pg_customer_id       text,
  pg_subscription_id   text,
  canceled_at          timestamptz
);

create table if not exists ci_usage_counters (
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,
  metric       text not null check (metric in ('tracked_channels','ai_calls','snapshots')),
  period_start date not null,
  value        bigint not null default 0,
  primary key (workspace_id, metric, period_start)
);

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_jobs               enable row level security;
alter table ci_job_runs           enable row level security;
alter table ci_snapshot_schedules enable row level security;
alter table ci_corrections        enable row level security;
alter table ci_alert_rules        enable row level security;
alter table ci_notifications      enable row level security;
alter table ci_plans              enable row level security;
alter table ci_subscriptions      enable row level security;
alter table ci_usage_counters     enable row level security;

-- 잡은 읽기만 노출한다. 쓰기는 service_role(워커)만 — 요청 경로에서 잡 상태를 조작할 수 없다.
drop policy if exists ci_jobs_select on ci_jobs;
create policy ci_jobs_select on ci_jobs for select
  using (workspace_id is not null and ci_is_member(workspace_id));

drop policy if exists ci_job_runs_select on ci_job_runs;
create policy ci_job_runs_select on ci_job_runs for select
  using (exists (select 1 from ci_jobs j
                 where j.id = job_id and j.workspace_id is not null
                   and ci_is_member(j.workspace_id)));

drop policy if exists ci_snapshot_select on ci_snapshot_schedules;
create policy ci_snapshot_select on ci_snapshot_schedules for select
  using (ci_is_member(workspace_id));

drop policy if exists ci_corrections_rw on ci_corrections;
create policy ci_corrections_rw on ci_corrections for all
  using (ci_is_member(workspace_id)) with check (ci_can_write(workspace_id));

drop policy if exists ci_alert_rules_rw on ci_alert_rules;
create policy ci_alert_rules_rw on ci_alert_rules for all
  using (ci_is_member(workspace_id)) with check (ci_can_admin(workspace_id));

drop policy if exists ci_notifications_select on ci_notifications;
create policy ci_notifications_select on ci_notifications for select
  using (user_id = auth.uid());
drop policy if exists ci_notifications_update on ci_notifications;
create policy ci_notifications_update on ci_notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ci_plans_select on ci_plans;
create policy ci_plans_select on ci_plans for select using (auth.uid() is not null);
drop policy if exists ci_plans_write on ci_plans;
create policy ci_plans_write on ci_plans for all
  using (ci_is_app_admin()) with check (ci_is_app_admin());

drop policy if exists ci_subscriptions_select on ci_subscriptions;
create policy ci_subscriptions_select on ci_subscriptions for select
  using (ci_is_member(workspace_id));

drop policy if exists ci_usage_select on ci_usage_counters;
create policy ci_usage_select on ci_usage_counters for select
  using (ci_is_member(workspace_id));

commit;
