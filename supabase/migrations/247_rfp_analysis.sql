-- 247_rfp_analysis.sql
--
-- RFP 분석기 2층 — 분석·리포트·설정 (설계서 3.7.2)
--
-- ## 이 층이 지키는 것 하나
--
-- **리포트는 덮어쓰지 않는다.** 기본 분석이 v1, 교차검증이 v2, 사용자 확정이 v3 로 쌓이고
-- 각 판은 그대로 남는다(설계서 3.5.6 「병합 방식 확정: 덮어쓰기 금지, 병기」).
-- 그래서 `rfp_report_versions.report` 는 **불변 JSON** 이고, 화면이 읽는 값은
-- 거기서 파생한 `rfp_report_fields` 다. 두 곳에 같은 값이 있는 것은 중복이 아니라
-- 「원본」과 「색인」의 관계다.
--
-- ## org_id 가 없는 표 셋
--
-- `rfp_report_schemas` · `rfp_ai_vendors` · `rfp_ai_models` 는 조직 데이터가 아니라
-- **공용 카탈로그**다(설계서 3.7.2 도 org_id 를 두지 않았다). 조직 키를 붙이면
-- 모델 하나를 등록할 때마다 조직 수만큼 행이 생긴다. 대신 읽기는 로그인한 사람 전부,
-- 쓰기는 admin 으로 잠근다.

-- ── ① 작업 큐와 실행 기록 ──────────────────────────────────────

create table if not exists rfp_analysis_jobs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  case_id     uuid references rfp_cases(id) on delete cascade,
  job_type    text not null,
  payload     jsonb not null default '{}',
  priority    int not null default 5,
  status      text not null default 'queued'
              check (status in ('queued','running','done','failed','dead')),
  attempts    int not null default 0,
  -- 어느 워커가 집어 갔나. SKIP LOCKED 로 선점하고 여기 이름을 남긴다
  locked_by   text,
  locked_at   timestamptz,
  progress    jsonb not null default '{}',
  error       text,
  -- 같은 단계를 두 번 걸지 않는다. 재수집은 payload 의 버전을 올려 새 키를 만든다
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_rfp_jobs_pick on rfp_analysis_jobs (status, priority, created_at);
create unique index if not exists uq_rfp_jobs_dedupe
  on rfp_analysis_jobs (org_id, dedupe_key) where dedupe_key is not null;

create table if not exists rfp_analysis_runs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references rfp_orgs(id) on delete cascade,
  case_id          uuid not null references rfp_cases(id) on delete cascade,
  job_id           uuid references rfp_analysis_jobs(id) on delete set null,
  -- 기본 / 사전 교차검증 / 사후 항목별 교차검증(설계서 3.7.3)
  mode             text not null check (mode in ('base','cross_pre','cross_post')),
  base_model_id    uuid,
  cross_model_ids  uuid[] not null default '{}',
  -- cross_post 일 때 어느 항목을 다시 봤나
  target_fields    text[] not null default '{}',
  requested_by     uuid,
  -- 지정 벤더가 죽어 다른 벤더로 갔으면 그 사실을 남긴다(설계서 3.5.5)
  fallback_applied jsonb not null default '[]',
  cost_krw         numeric(14,2),
  duration_ms      int,
  status           text not null default 'running',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists idx_rfp_runs_case on rfp_analysis_runs (org_id, case_id, started_at desc);

-- 호출 하나가 한 행. 비용 대시보드와 월 예산 상한이 이 표를 센다
create table if not exists rfp_llm_calls (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid references rfp_analysis_runs(id) on delete cascade,
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  model_id          uuid,
  purpose           text,
  input_tokens      int,
  output_tokens     int,
  cache_read_tokens int,
  cost_krw          numeric(14,4),
  latency_ms        int,
  status            text,
  error             text,
  request_hash      text,
  redaction_applied boolean not null default false,
  doc_class         text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_rfp_llm_calls_org_time on rfp_llm_calls (org_id, created_at desc);

-- ── ② 리포트 ───────────────────────────────────────────────────

create table if not exists rfp_report_schemas (
  id          uuid primary key default gen_random_uuid(),
  version     text not null unique,
  json_schema jsonb not null,
  field_defs  jsonb not null default '{}',
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 불변 저장. 한 번 쓴 판은 고치지 않는다
create table if not exists rfp_report_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references rfp_orgs(id) on delete cascade,
  case_id        uuid not null references rfp_cases(id) on delete cascade,
  version        int not null,
  schema_version text,
  run_id         uuid references rfp_analysis_runs(id) on delete set null,
  report         jsonb not null,
  -- 보고용 요약은 같은 JSON 에서 파생한다. 따로 생성 호출을 하지 않는다(설계서 3.3.6)
  summary        jsonb,
  created_at     timestamptz not null default now(),
  unique (case_id, version)
);

-- 화면 표시의 단일 출처. 어느 벤더 값이 보이는지 display_model_id 가 밝힌다
create table if not exists rfp_report_fields (
  id                uuid primary key default gen_random_uuid(),
  report_version_id uuid not null references rfp_report_versions(id) on delete cascade,
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  field_path        text not null,
  value             jsonb,
  -- 숫자·문자를 따로 뽑아 두어야 예산 구간 검색이 인덱스를 탄다
  value_num         numeric,
  value_text        text,
  confidence        real,
  grounding         text check (grounding in ('confirmed','unconfirmed')),
  verification      text check (verification in ('single','agreed','majority','conflict','user_fixed')),
  display_model_id  uuid,
  evidence          jsonb not null default '[]'
);
create index if not exists idx_rfp_fields_path on rfp_report_fields (org_id, field_path, value_num);
create index if not exists idx_rfp_fields_version on rfp_report_fields (report_version_id);

-- 벤더별 결과. 기본 모드 결과도 여기 남겨야 교차검증에서 재사용된다(설계서 3.7.3)
create table if not exists rfp_field_vendor_results (
  id                uuid primary key default gen_random_uuid(),
  report_version_id uuid not null references rfp_report_versions(id) on delete cascade,
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  field_path        text not null,
  model_id          uuid,
  value             jsonb,
  evidence          jsonb not null default '[]',
  confidence        real,
  grounding         text,
  agreed            boolean,
  -- 같은 값끼리 묶은 번호. 합의율은 이 묶음의 가중치 합으로 낸다
  cluster_id        int,
  created_at        timestamptz not null default now(),
  unique (report_version_id, field_path, model_id)
);

-- 사람이 고른 최종값. 어느 벤더가 맞았는지가 벤더 가중치 보정의 원천이다
create table if not exists rfp_field_resolutions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  case_id         uuid not null references rfp_cases(id) on delete cascade,
  field_path      text not null,
  resolved_value  jsonb,
  source          text not null check (source in ('user','consensus')),
  chosen_model_id uuid,
  resolved_by     uuid,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_rfp_resolutions_case on rfp_field_resolutions (org_id, case_id);

-- ── ③ 이상 조항 ────────────────────────────────────────────────
-- 규칙은 DB 에 두고 코드는 실행기만 갖는다(설계서 3.8.2). 임계값이 바뀔 때
-- 배포를 기다리지 않아야 하고, 무엇이 켜져 있는지 화면에서 보여야 한다.

create table if not exists rfp_anomaly_rules (
  id               text primary key,
  org_id           uuid references rfp_orgs(id) on delete cascade,
  category         text not null,
  name             text not null,
  description      text,
  rule_type        text not null check (rule_type in ('regex','numeric','stat','llm')),
  definition       jsonb not null default '{}',
  severity_default text not null default 'contract'
                   check (severity_default in ('blocking','margin','contract','competition')),
  enabled          boolean not null default true,
  updated_at       timestamptz not null default now()
);

create table if not exists rfp_anomalies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  case_id           uuid not null references rfp_cases(id) on delete cascade,
  report_version_id uuid references rfp_report_versions(id) on delete cascade,
  category          text not null,
  severity          text not null default 'contract'
                    check (severity in ('blocking','margin','contract','competition')),
  -- 확정은 규칙이 사실로 잡은 것, 의심은 AI·통계 단독 신호다. 섞지 않는다
  grade             text not null check (grade in ('confirmed','suspect','dismissed')),
  title             text not null,
  rationale         text,
  evidence          jsonb not null default '[]',
  rule_id           text references rfp_anomaly_rules(id) on delete set null,
  found_by_model_ids uuid[] not null default '{}',
  -- 사람이 기각한 데이터가 규칙 임계값 조정에 쓰인다
  user_status       text,
  reviewed_by       uuid,
  created_at        timestamptz not null default now()
);
create index if not exists idx_rfp_anomalies_case on rfp_anomalies (org_id, case_id, grade);

-- ── ④ 회사 프로필 ──────────────────────────────────────────────
-- 버전 관리한다. 판정이 어느 판의 프로필로 나왔는지 못 대면 판정을 못 믿는다.

create table if not exists rfp_company_profiles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references rfp_orgs(id) on delete cascade,
  version    int not null,
  status     text not null default 'draft' check (status in ('draft','active','archived')),
  basic      jsonb not null default '{}',
  preferences jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, version)
);

create table if not exists rfp_profile_certifications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references rfp_orgs(id) on delete cascade,
  profile_id       uuid not null references rfp_company_profiles(id) on delete cascade,
  kind             text,
  name             text not null,
  issuer           text,
  valid_until      date,
  evidence_file_id uuid
);

create table if not exists rfp_profile_track_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references rfp_orgs(id) on delete cascade,
  profile_id       uuid not null references rfp_company_profiles(id) on delete cascade,
  project_name     text not null,
  client           text,
  amount           bigint,
  start_date       date,
  end_date         date,
  domain_tags      text[] not null default '{}',
  role             text,
  evidence_file_id uuid,
  embedding        vector(768)
);

create table if not exists rfp_profile_capabilities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  profile_id  uuid not null references rfp_company_profiles(id) on delete cascade,
  tag         text not null,
  level       int check (level between 1 and 5),
  description text,
  embedding   vector(768)
);

create table if not exists rfp_profile_partners (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references rfp_orgs(id) on delete cascade,
  profile_id   uuid not null references rfp_company_profiles(id) on delete cascade,
  partner_name text not null,
  capabilities text[] not null default '{}',
  note         text
);

-- ── ⑤ 적합도와 비교 ────────────────────────────────────────────

create table if not exists rfp_fit_assessments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references rfp_orgs(id) on delete cascade,
  case_id           uuid not null references rfp_cases(id) on delete cascade,
  profile_id        uuid references rfp_company_profiles(id) on delete set null,
  report_version_id uuid references rfp_report_versions(id) on delete set null,
  verdict           text not null check (verdict in ('full','partial','unfit')),
  score             real,
  -- 요건별 충족·미충족·확인불가. 「확인 불가」를 「미충족」으로 접지 않는다
  hard_constraints  jsonb not null default '[]',
  soft_scores       jsonb not null default '{}',
  gaps              jsonb not null default '[]',
  rationale         text,
  model_id          uuid,
  created_at        timestamptz not null default now()
);
create index if not exists idx_rfp_fit_case on rfp_fit_assessments (org_id, case_id, created_at desc);

create table if not exists rfp_comparisons (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  case_id         uuid not null references rfp_cases(id) on delete cascade,
  similar_case_id uuid not null references rfp_cases(id) on delete cascade,
  similarity      real,
  structured_diff jsonb not null default '{}',
  ai_summary      jsonb,
  created_at      timestamptz not null default now(),
  unique (case_id, similar_case_id)
);

-- ── ⑥ 벤더 설정 ────────────────────────────────────────────────

create table if not exists rfp_ai_vendors (
  id               text primary key,
  name             text not null,
  litellm_provider text,
  -- 학습 미사용·기본 보존일·ZDR 가능 여부. 등급 정책이 이 값을 읽는다
  retention_policy jsonb not null default '{}',
  -- 사내 서빙은 외부 전송이 아니다(F10)
  is_internal      boolean not null default false,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists rfp_ai_models (
  id                     uuid primary key default gen_random_uuid(),
  vendor_id              text not null references rfp_ai_vendors(id) on delete cascade,
  model_id               text not null,
  display_name           text,
  max_input_tokens       int,
  max_output_tokens      int,
  supports_json_schema   boolean not null default false,
  supports_pdf_input     boolean not null default false,
  supports_image_input   boolean not null default false,
  supports_prompt_cache  boolean not null default false,
  price_input_per_1m     numeric(12,4),
  price_output_per_1m    numeric(12,4),
  price_cache_read_per_1m numeric(12,4),
  -- 관측값이라 코드가 주기적으로 덮어쓴다
  avg_latency_ms         int,
  tokens_per_sec         int,
  region                 text,
  -- 기본은 공개 문서만. 등급을 넓히는 것은 사람이 근거를 보고 하는 결정이다
  allowed_doc_classes    text[] not null default '{public}',
  enabled                boolean not null default true,
  deprecated_at          date,
  unique (vendor_id, model_id)
);

-- 키는 암호화해서 담는다. 마스터 키만 env 에 남는다(설계서 4장 10)
create table if not exists rfp_ai_vendor_credentials (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  vendor_id       text not null references rfp_ai_vendors(id) on delete cascade,
  encrypted_key   bytea not null,
  key_iv          bytea not null,
  -- 사내 서빙 엔드포인트 주소. 외부 벤더는 null
  base_url        text,
  status          text not null default 'unknown',
  last_checked_at timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (org_id, vendor_id)
);

create table if not exists rfp_ai_settings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references rfp_orgs(id) on delete cascade,
  scope               text not null check (scope in ('org','user')),
  user_id             uuid,
  base_model_id       uuid references rfp_ai_models(id) on delete set null,
  cross_model_ids     uuid[] not null default '{}',
  vendor_weights      jsonb not null default '{}',
  fallback_order      uuid[] not null default '{}',
  monthly_budget_krw  bigint,
  -- 권장 점수가 이 값을 넘으면 배지를 단다(설계서 3.5.6)
  recommend_threshold numeric(4,2) not null default 1.5,
  big_project_krw     bigint not null default 1000000000,
  updated_at          timestamptz not null default now()
);
-- 조직 설정은 한 벌, 사용자 설정은 사람당 한 벌
create unique index if not exists uq_rfp_ai_settings_org
  on rfp_ai_settings (org_id) where scope = 'org';
create unique index if not exists uq_rfp_ai_settings_user
  on rfp_ai_settings (org_id, user_id) where scope = 'user';

-- ── ⑦ 감사 ─────────────────────────────────────────────────────
-- 케이스를 지워도 남는다(설계서 3.7.3). 「이 문서가 어디로 나갔나」에 답하는 유일한 기록이다.

create table if not exists rfp_external_transfers (
  id                bigserial primary key,
  org_id            uuid not null,
  case_id           uuid,
  file_id           uuid,
  vendor_id         text,
  model_id          uuid,
  purpose           text,
  doc_class         text,
  token_count       int,
  redaction_applied boolean not null default false,
  approved_by       uuid,
  approval_reason   text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_rfp_transfers_case on rfp_external_transfers (org_id, case_id, created_at desc);

create table if not exists rfp_audit_logs (
  id          bigserial primary key,
  org_id      uuid not null,
  user_id     uuid,
  action      text not null,
  target_type text,
  target_id   uuid,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_rfp_audit_org_time on rfp_audit_logs (org_id, created_at desc);

-- ── ⑧ 벤더·모델 시드 ───────────────────────────────────────────
-- 값은 관리자 화면에서 갱신한다(설계서 3.5.2). 여기 있는 것은 출발점일 뿐이다.
-- 모델 목록은 부록 C 가 아니라 **이 저장소의 실사용 SSOT** 를 따랐다 —
-- 부록 C 는 스스로 "재확인 필수"라 적었고, 실제로 도는 사슬은
-- `lib/ai/gemini-model.ts` 와 `lib/ai-chat/pricing.ts` 가 안다.

insert into rfp_ai_vendors (id, name, litellm_provider, retention_policy, is_internal) values
  ('anthropic', 'Anthropic', 'anthropic',
   '{"noTraining":true,"retentionDays":30,"zeroRetention":false}', false),
  ('openai',    'OpenAI',    'openai',
   '{"noTraining":true,"retentionDays":30,"zeroRetention":false}', false),
  ('google',    'Google',    'gemini',
   '{"noTraining":true,"retentionDays":0,"zeroRetention":false,"note":"유료 티어만. 무료 키는 사람 검토 포함 학습 활용"}', false),
  ('xai',       'xAI',       'xai',
   '{"noTraining":true,"retentionDays":30,"zeroRetention":false}', false),
  ('groq',      'Groq',      'groq',
   '{"noTraining":true,"retentionDays":0,"zeroRetention":true}', false),
  ('internal',  '사내 서빙 (gcube)', 'openai',
   '{"noTraining":true,"retentionDays":0,"zeroRetention":true}', true)
on conflict (id) do nothing;

insert into rfp_ai_models
  (vendor_id, model_id, display_name, max_input_tokens, max_output_tokens,
   supports_json_schema, supports_pdf_input, supports_image_input, supports_prompt_cache,
   price_input_per_1m, price_output_per_1m, allowed_doc_classes)
values
  ('anthropic','claude-fable-5','Claude Fable 5', 1000000, 64000, true, true, true, true, 10, 50, '{public}'),
  ('anthropic','claude-opus-4-8','Claude Opus 4.8', 1000000, 128000, true, true, true, true, 5, 25, '{public}'),
  ('anthropic','claude-sonnet-4-6','Claude Sonnet 4.6', 1000000, 64000, true, true, true, true, 3, 15, '{public}'),
  ('google','gemini-3.6-flash','Gemini 3.6 Flash', 1000000, 64000, true, true, true, false, null, null, '{public}'),
  ('google','gemini-3.7-flash','Gemini 3.7 Flash', 1000000, 64000, true, true, true, false, null, null, '{public}'),
  ('google','gemini-flash-latest','Gemini Flash (latest)', 1000000, 64000, true, true, true, false, null, null, '{public}'),
  ('google','gemini-flash-lite-latest','Gemini Flash Lite (latest)', 1000000, 64000, true, true, true, false, null, null, '{public}'),
  ('openai','gpt-4o','GPT-4o', 128000, 16384, true, true, true, false, 2.5, 10, '{public}'),
  ('openai','gpt-4o-mini','GPT-4o mini', 128000, 16384, true, true, true, false, 0.15, 0.6, '{public}')
on conflict (vendor_id, model_id) do nothing;

-- ── ⑨ RLS ─────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'rfp_analysis_jobs','rfp_analysis_runs','rfp_llm_calls','rfp_report_versions',
    'rfp_report_fields','rfp_field_vendor_results','rfp_field_resolutions',
    'rfp_anomalies','rfp_company_profiles','rfp_profile_certifications',
    'rfp_profile_track_records','rfp_profile_capabilities','rfp_profile_partners',
    'rfp_fit_assessments','rfp_comparisons','rfp_ai_vendor_credentials','rfp_ai_settings'
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

  -- 규칙 표는 조직별 규칙과 공용 규칙이 섞인다(org_id null = 공용)
  execute 'alter table rfp_anomaly_rules enable row level security';
  execute 'drop policy if exists rfp_anomaly_rules_read on rfp_anomaly_rules';
  execute 'create policy rfp_anomaly_rules_read on rfp_anomaly_rules for select
             using (org_id is null or org_id in (select rfp_my_orgs()))';
  execute 'drop policy if exists rfp_anomaly_rules_admin on rfp_anomaly_rules';
  execute 'create policy rfp_anomaly_rules_admin on rfp_anomaly_rules for all
             using (org_id is not null and rfp_is_admin(org_id))
             with check (org_id is not null and rfp_is_admin(org_id))';

  -- 감사 기록은 **넣기만 한다.** 고치거나 지우는 정책을 아예 만들지 않는다
  foreach t in array array['rfp_external_transfers','rfp_audit_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (org_id in (select rfp_my_orgs()))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_append', t);
    execute format('create policy %I on %I for insert with check (org_id in (select rfp_my_orgs()))', t||'_append', t);
  end loop;

  -- 공용 카탈로그 셋 — 읽기는 로그인한 사람 전부, 쓰기는 admin
  foreach t in array array['rfp_report_schemas','rfp_ai_vendors','rfp_ai_models'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (auth.uid() is not null)', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_admin', t);
    execute format('create policy %I on %I for all
                      using (rfp_is_admin(rfp_default_org()))
                      with check (rfp_is_admin(rfp_default_org()))', t||'_admin', t);
  end loop;
end $$;
