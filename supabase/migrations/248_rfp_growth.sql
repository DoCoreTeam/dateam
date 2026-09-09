-- 248_rfp_growth.sql
--
-- RFP 분석기 3층 — 학습·확장·테넌트 (설계서 F7·F8·F9·F11·F12)
--
-- ## 이 층이 없으면 무엇이 안 되나
--
-- 설계서 4장 5: 「축적할수록 정확도가 저절로 개선」은 **정답 데이터 없이는 거짓**이다.
-- 우리가 참여했는지, 누가 얼마에 따갔는지를 적어 두지 않으면 판정이 맞았는지 영영 모른다.
-- `rfp_outcomes` 가 그 정답지다. 나머지 표는 그 정답지를 채우거나(레이더·정정공고)
-- 쓰거나(제안서) 파는(요금제·사용량) 자리다.
--
-- ## 요금제 표를 지금 만드는 이유
--
-- 팔지 않아도 **사용량은 지금부터 샌다.** 조직별로 얼마나 썼는지 못 세면
-- 「이번 달 AI 비용이 왜 이렇지」에 답할 수 없고, 그 답이 없으면 상한도 못 건다.

-- ── ① 결과 피드백 (F7) ─────────────────────────────────────────
-- 케이스당 한 행. 두 번 수집해도 한 행이어야 「몇 건 이겼나」가 부풀지 않는다.

create table if not exists rfp_outcomes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  case_id         uuid not null references rfp_cases(id) on delete cascade,
  -- 우리가 무엇을 하기로 했나. 「아직 안 정함」을 「안 하기로 함」으로 접지 않는다
  decision        text not null default 'undecided'
                  check (decision in ('go','partial','no_go','undecided')),
  decision_reason text,
  submitted       boolean,
  -- 낙찰 결과. 나라장터에서 자동으로 채워지거나 사람이 적는다
  result          text check (result in ('won','lost','cancelled','unknown')),
  awarded_to      text,
  awarded_amount  bigint,
  our_rank        int,
  -- 사람이 적은 값을 자동 수집이 덮지 않게 출처를 남긴다
  source          text not null default 'manual' check (source in ('manual','g2b')),
  recorded_by     uuid,
  recorded_at     timestamptz not null default now(),
  unique (case_id)
);

-- ── ② 자동 레이더와 알림 (F8) ──────────────────────────────────

create table if not exists rfp_radar_rules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references rfp_orgs(id) on delete cascade,
  name           text not null,
  keywords       text[] not null default '{}',
  classifications text[] not null default '{}',
  budget_min     bigint,
  budget_max     bigint,
  agencies       text[] not null default '{}',
  enabled        boolean not null default true,
  last_swept_at  timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create table if not exists rfp_radar_hits (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  rule_id     uuid not null references rfp_radar_rules(id) on delete cascade,
  source_id   uuid references rfp_sources(id) on delete cascade,
  -- 아직 케이스로 만들지 않은 후보. 사람이 열어 봐야 케이스가 된다(§5-3 확정은 사람)
  case_id     uuid references rfp_cases(id) on delete set null,
  pre_score   real,
  reason      text,
  status      text not null default 'new' check (status in ('new','opened','dismissed')),
  created_at  timestamptz not null default now(),
  -- 같은 공고를 두 번 담지 않는다
  unique (rule_id, source_id)
);
create index if not exists idx_rfp_radar_hits_org on rfp_radar_hits (org_id, status, pre_score desc);

create table if not exists rfp_notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  user_id     uuid,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rfp_notifications_user
  on rfp_notifications (org_id, user_id, created_at desc) where read_at is null;

-- ── ③ 제안서 목차와 전략 (F9) ──────────────────────────────────
-- 목차 항목마다 근거 요구사항 ID 를 단다. 근거 없는 목차는 남의 목차다.

create table if not exists rfp_proposals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  case_id           uuid not null references rfp_cases(id) on delete cascade,
  report_version_id uuid references rfp_report_versions(id) on delete set null,
  fit_id            uuid references rfp_fit_assessments(id) on delete set null,
  outline           jsonb not null default '[]',
  strategy          jsonb not null default '{}',
  model_id          uuid,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index if not exists idx_rfp_proposals_case on rfp_proposals (org_id, case_id, created_at desc);

-- ── ④ 정정공고와 버전 비교 (F11) ───────────────────────────────
-- 같은 공고의 차수를 잇는다. 앞 차수를 지우지 않는다 —
-- 「무엇이 바뀌었나」는 양쪽이 다 있어야 답할 수 있다.

create table if not exists rfp_case_revisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references rfp_orgs(id) on delete cascade,
  notice_no     text not null,
  round         int not null,
  case_id       uuid not null references rfp_cases(id) on delete cascade,
  is_latest     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (org_id, notice_no, round)
);
create index if not exists idx_rfp_revisions_latest
  on rfp_case_revisions (org_id, notice_no) where is_latest;

create table if not exists rfp_revision_diffs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references rfp_orgs(id) on delete cascade,
  from_case_id   uuid not null references rfp_cases(id) on delete cascade,
  to_case_id     uuid not null references rfp_cases(id) on delete cascade,
  -- 필드 단위 diff. 바뀐 값과 양쪽 근거를 함께 담는다
  field_diffs    jsonb not null default '[]',
  summary        text,
  created_at     timestamptz not null default now(),
  unique (from_case_id, to_case_id)
);

-- ── ⑤ 요금제와 사용량 (F12) ────────────────────────────────────

create table if not exists rfp_plans (
  id                 text primary key,
  name               text not null,
  -- null 이면 무제한. 0 을 무제한으로 쓰면 「0건까지 허용」과 구분이 안 된다
  monthly_case_limit int,
  monthly_ai_krw     bigint,
  max_members        int,
  cross_verify       boolean not null default false,
  assistant          boolean not null default false,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now()
);

insert into rfp_plans (id, name, monthly_case_limit, monthly_ai_krw, max_members, cross_verify, assistant, sort_order) values
  ('internal', '사내',   null, null, null, true,  true,  0),
  ('team',     '팀',     50,   300000, 10,  true,  true,  1),
  ('starter',  '스타터', 10,   50000,  3,   false, false, 2)
on conflict (id) do nothing;

-- 조직마다 어느 요금제인지. 사내는 기본으로 internal
alter table rfp_orgs add column if not exists plan_id text references rfp_plans(id);
update rfp_orgs set plan_id = 'internal' where plan_id is null;

-- 사용량 원장 — llm_calls 와 OCR 페이지를 조직·월 단위로 접는다.
-- 원장을 따로 두는 이유: 호출 표는 케이스를 지우면 함께 사라지는데
-- **청구 근거는 사라지면 안 된다.**
create table if not exists rfp_usage_ledger (
  id           bigserial primary key,
  org_id       uuid not null,
  period       text not null,            -- 'YYYY-MM' (KST 기준)
  kind         text not null,            -- 'llm' | 'image_text' | 'commercial_parser'
  units        bigint not null default 0,
  cost_krw     numeric(14,2) not null default 0,
  updated_at   timestamptz not null default now(),
  unique (org_id, period, kind)
);
create index if not exists idx_rfp_usage_org_period on rfp_usage_ledger (org_id, period);

create table if not exists rfp_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('admin','member','viewer')),
  token       text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

-- ── ⑥ RLS ─────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'rfp_outcomes','rfp_radar_rules','rfp_radar_hits','rfp_proposals',
    'rfp_case_revisions','rfp_revision_diffs','rfp_invites'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (org_id in (select rfp_my_orgs()))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for insert with check (rfp_can_write(org_id))', t||'_write', t);
    execute format('drop policy if exists %I on %I', t||'_update', t);
    execute format('create policy %I on %I for update using (rfp_can_write(org_id)) with check (rfp_can_write(org_id))', t||'_update', t);
    execute format('drop policy if exists %I on %I', t||'_delete', t);
    execute format('create policy %I on %I for delete using (rfp_is_admin(org_id))', t||'_delete', t);
  end loop;
end $$;

-- 알림은 자기 것만 본다 — 같은 조직이라도 남의 알림을 읽을 이유가 없다
alter table rfp_notifications enable row level security;
drop policy if exists rfp_notifications_read on rfp_notifications;
create policy rfp_notifications_read on rfp_notifications for select
  using (org_id in (select rfp_my_orgs()) and (user_id is null or user_id = auth.uid()));
drop policy if exists rfp_notifications_update on rfp_notifications;
create policy rfp_notifications_update on rfp_notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rfp_notifications_write on rfp_notifications;
create policy rfp_notifications_write on rfp_notifications for insert
  with check (org_id in (select rfp_my_orgs()));

-- 사용량 원장은 읽기만 — 청구 근거를 사람이 고칠 수 있으면 근거가 아니다.
-- 쓰기는 서비스 롤(워커)만 한다.
alter table rfp_usage_ledger enable row level security;
drop policy if exists rfp_usage_ledger_read on rfp_usage_ledger;
create policy rfp_usage_ledger_read on rfp_usage_ledger for select
  using (org_id in (select rfp_my_orgs()));

-- 요금제는 공용 카탈로그
alter table rfp_plans enable row level security;
drop policy if exists rfp_plans_read on rfp_plans;
create policy rfp_plans_read on rfp_plans for select using (auth.uid() is not null);
drop policy if exists rfp_plans_admin on rfp_plans;
create policy rfp_plans_admin on rfp_plans for all
  using (rfp_is_admin(rfp_default_org())) with check (rfp_is_admin(rfp_default_org()));
