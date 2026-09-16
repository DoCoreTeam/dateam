-- 253 서비스를 안 가리는 AI 원장
--
-- 왜: 기록을 받을 표가 rfp_llm_calls 와 rfp_external_transfers 뿐인데 둘 다 rfp_orgs 를
--   참조한다. 그래서 RFP 밖에서 나가는 호출은 적을 자리가 없고, 실제로 개인정보가 지나는
--   여덟 길이 전부 기록 없이 나가고 있었다 (실측 2026-09-16).
--   무엇이 언제 어디로 나갔는지 못 물으면 사고가 나도 범위를 못 정한다.
--
-- RFP 표는 건드리지 않는다. 옮기는 것이 아니라 옆에 두는 것이다. 돌고 있는 것을 멈추고
--   옮기면 그 사이에 난 호출이 어느 원장에도 안 남는다.
--
-- surface 칸이 있는 이유: 어디서 났는지 없으면 원장을 봐도 어디서 샜는지 모른다.
--   사고 대응은 언제나 «어느 화면이 그랬나» 에서 시작한다.
--
-- 가린 값 자체는 안 남긴다. 종류별 건수만 남긴다. 원장이 유출 경로가 되면 안 된다.
--
-- 되돌리기:
--   drop table if exists ai_external_transfers;
--   drop table if exists ai_llm_calls;

create table if not exists ai_llm_calls (
  id                uuid primary key default gen_random_uuid(),
  -- 어느 화면이 불렀나. 사고 대응이 여기서 시작한다
  surface           text not null,
  -- 무엇을 하려고 불렀나. 비용을 이 단위로 센다
  purpose           text not null,
  -- 누가 불렀나. 로그인 사용자가 없는 배치는 null
  actor_id          uuid,
  provider_id       text,
  model_name        text,
  input_tokens      int,
  output_tokens     int,
  cost_krw          numeric(14,4),
  latency_ms        int,
  ok                boolean not null,
  error             text,
  contract_version  int,
  created_at        timestamptz not null default now()
);
create index if not exists idx_ai_llm_calls_time on ai_llm_calls (created_at desc);
create index if not exists idx_ai_llm_calls_surface on ai_llm_calls (surface, created_at desc);

create table if not exists ai_external_transfers (
  id                uuid primary key default gen_random_uuid(),
  surface           text not null,
  purpose           text not null,
  actor_id          uuid,
  provider_id       text,
  model_name        text,
  -- 무엇을 몇 개 가렸나. 값은 안 남긴다
  masked_counts     jsonb not null default '{}',
  -- 가림이 애초에 안 닿는 것을 보냈나 (그림, 소리)
  media_kind        text check (media_kind in ('text', 'image', 'audio')),
  bytes             int,
  contract_version  int,
  created_at        timestamptz not null default now()
);
create index if not exists idx_ai_transfers_time on ai_external_transfers (created_at desc);
create index if not exists idx_ai_transfers_surface on ai_external_transfers (surface, created_at desc);

comment on table ai_llm_calls is
  '서비스를 안 가리는 AI 호출 원장. RFP 전용 rfp_llm_calls 와 별개이고 그쪽을 대체하지 않는다';
comment on column ai_external_transfers.masked_counts is
  '가린 종류별 건수만. 가린 값 자체는 절대 안 남긴다, 원장이 유출 경로가 되면 안 된다';
comment on column ai_external_transfers.media_kind is
  '글자가 아니면 글자 가림이 애초에 안 닿는다. 명함 사진과 회의 녹음이 그렇다';
