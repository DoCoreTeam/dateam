-- 262_ci_discovery_answers.sql
--
-- 같은 질문을 두 번 하지 않기 위한 자리.
--
-- 발견은 «떡상 1건 vs 평범 3건» 한 묶음을 AI 에게 보여 주고 «이 하나만 다른 점»을 묻는다.
-- 그 묶음의 입력(제목·설명·길이·게시일)은 수집이 끝나면 변하지 않고 호출은 temperature 0 이다.
-- 즉 같은 묶음에는 같은 답이 온다. 그런데 답을 두는 자리가 없어서 매번 다시 물었다.
--
-- 실측 2026-09-20
--   서로 다른 질문은 최대 624개(떡상 콘텐츠 수)인데 사흘 동안 49,064번 물었다 — 78.6배
--   그중 46,212번이 한도로 실패했고, 그동안 같은 키를 쓰는 회의노트와 CRM 이 함께 죽었다
--
-- ## 지문에 무엇이 들어가나
--
-- 묶음에 속한 콘텐츠의 신원과 프롬프트 판 번호뿐이다(lib/ci/analysis/contrast-key.ts).
-- 배수는 **일부러 뺐다.** 배수는 채널 중앙값 대비라 형제가 하나 들어올 때마다 흔들리고,
-- 지문에 넣으면 내용이 한 글자도 안 바뀌었는데 날마다 다시 묻게 된다.
-- 대신 배수가 떡상 자격을 넘나들면 묶음 구성 자체가 달라져 지문이 제대로 달라진다.
--
-- ## 왜 found:false 도 적나
--
-- 「이 묶음에서는 차이를 못 찾았다」를 확인하는 데도 호출 한 번이 들었다.
-- 안 적으면 못 찾은 묶음만 영원히 다시 묻게 되고, 그것이 가장 흔한 경우다.

create table if not exists ci_discovery_answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ci_workspaces(id) on delete cascade,

  -- 지문. 같은 지문은 같은 질문이다
  contrast_key text not null,
  -- 프롬프트를 고치면 올린다. 지문 안에도 들어 있지만 따로 두어야 «판 2 를 전부 지워라» 가 된다
  prompt_version integer not null,

  -- 누구를 물었나. 사람이 원장을 볼 때 지문만으로는 아무것도 안 보인다
  winner_content_id uuid references ci_contents(id) on delete cascade,

  -- 답. found=false 면 나머지는 빈 값이다
  found boolean not null,
  statement text not null default '',
  observation text not null default '',
  kind text not null default 'other',

  -- 어느 모델이 답했나. 모델을 바꾼 뒤 답이 이상하면 되짚을 수 있어야 한다
  model_name text,
  created_at timestamptz not null default now()
);

-- 지문 하나에 답 하나. 이 제약이 없으면 같은 질문의 답이 여럿 쌓여
-- 「어느 것이 진짜인가」를 아무도 답할 수 없게 된다
create unique index if not exists uq_ci_discovery_answers_key
  on ci_discovery_answers (workspace_id, contrast_key);

-- 「판 1 의 답을 전부 버리자」와 「이 승자의 답을 다시 보자」가 자주 있는 조회다
create index if not exists idx_ci_discovery_answers_version
  on ci_discovery_answers (workspace_id, prompt_version);
create index if not exists idx_ci_discovery_answers_winner
  on ci_discovery_answers (winner_content_id);

alter table ci_discovery_answers enable row level security;

-- 읽기는 구성원. 쓰기 정책은 두지 않는다 — 채우는 것은 서버(관리자 키)뿐이고,
-- 사람이 손으로 답을 심으면 「AI 가 그렇게 말했다」가 거짓이 된다
drop policy if exists ci_discovery_answers_select on ci_discovery_answers;
create policy ci_discovery_answers_select on ci_discovery_answers
  for select using (ci_is_member(workspace_id));

comment on table ci_discovery_answers is
  '대조쌍 하나에 대한 AI 의 답. 지문이 같으면 다시 묻지 않는다 (P0030 I04)';
comment on column ci_discovery_answers.contrast_key is
  'lib/ci/analysis/contrast-key.ts contrastKey() 의 값. 배수는 일부러 안 들어간다';
comment on column ci_discovery_answers.found is
  'false 도 답이다. 못 찾았다는 확인에도 호출 한 번이 들었으므로 적어 둔다';
