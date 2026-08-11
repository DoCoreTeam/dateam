-- 191_ci_creative_analysis.sql
-- 잘 나간 콘텐츠의 "무엇이 통했나" 저장소
--
-- 제품의 존재 이유: 채널을 알면 → 그 채널 콘텐츠를 모으고 → 뭐가 터졌는지 보고 →
-- 터진 것의 썸네일 문구·구성·후킹 메시지를 뽑아 다음 기획에 쓴다.
-- 지금까지 배수만 계산하고 "왜 터졌는가"를 저장할 곳이 없었다.

begin;

create table if not exists ci_content_creative (
  content_id        uuid primary key references ci_contents(id) on delete cascade,
  workspace_id      uuid not null references ci_workspaces(id) on delete cascade,

  -- 썸네일에서 읽어낸 것
  thumbnail_text    text,                       -- 썸네일에 박힌 문구 (없으면 null)
  thumbnail_style   text[] not null default '{}', -- 인물클로즈업, 큰글자, 화살표, 대비색 …
  thumbnail_summary text,                        -- 한 문장 설명

  -- 제목·도입부에서 읽어낸 것
  hook_message      text,                        -- 후킹 문장 원문
  hook_type         text,                        -- 질문형, 숫자형, 반전, 공포, 이득 …
  title_pattern     text[] not null default '{}',-- 숫자포함, 괄호부제, 의문형 …

  -- 관측 가능한 것만 남긴다. 추측은 넣지 않는다.
  evidence          jsonb not null default '{}',
  model             text,
  analyzed_at       timestamptz not null default now()
);

create index if not exists idx_ci_creative_ws
  on ci_content_creative (workspace_id, analyzed_at desc);
create index if not exists idx_ci_creative_hook_type
  on ci_content_creative (workspace_id, hook_type) where hook_type is not null;

-- 채널 단위 일괄 수집 이력 — 같은 채널을 반복해서 훑지 않도록 커서를 남긴다
alter table ci_channels
  add column if not exists last_sweep_at timestamptz,
  add column if not exists sweep_cursor text,
  add column if not exists sweep_error text;

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_content_creative enable row level security;

drop policy if exists ci_creative_select on ci_content_creative;
create policy ci_creative_select on ci_content_creative for select
  using (ci_is_member(workspace_id));

-- 쓰기는 워커(service_role)만. 분석 결과를 사용자가 임의로 바꾸지 않는다.

commit;
