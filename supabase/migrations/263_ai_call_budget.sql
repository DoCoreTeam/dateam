-- 263_ai_call_budget.sql
--
-- 「오늘 몇 번 남았나」를 아는 자리.
--
-- 상한을 아는 자리가 한 곳도 없었다. 사슬도 재시도도 냉각도 간격도 각자 맞는 판단인데,
-- 아무도 남은 횟수를 몰라서 멈추라고 말할 수 있는 자리가 없었다.
--
-- 실측 2026-09-20
--   하루 호출 23,318건 중 22,131건 실패 — 무료 등급 하루 예산(약 600건)의 38.9배
--   분당 40.2회, 한도 5회 — 8배
--   원장 50,243건 전부 주인이 비어 있어 누가 태웠는지도 못 가렸다
--
-- ## 왜 env 가 아니라 표인가
--
-- 상한은 쓰다 보면 바뀐다. env 에 두면 바꿀 때마다 배포가 필요하고, 한도에 걸린
-- 그 순간에 배포를 기다려야 한다. 정책도 그렇게 말한다 — 새 설정은 env 추가 대신
-- DB 저장과 화면 관리.
--
-- ## 왜 기능 단위인가
--
-- 키는 하나인데 기능은 마흔이다. 한 기능이 몰아 쓰면 나머지 서른아홉이 같이 죽는다.
-- 실제로 그랬다 — 발견 하나가 하루 호출의 97.8% 를 썼고, 그동안 회의노트와 CRM 이
-- 같은 키의 한도에 걸려 함께 멎었다.
--
-- ## 없는 기능은 막지 않는다
--
-- 줄이 없으면 「상한을 모른다」는 뜻이고, 그때는 통과시킨다(lib/ai/budget.ts).
-- 셈이 안 된다고 사용자의 일을 멈추면 관측 장치가 장애 원인이 된다.

create table if not exists ai_call_budget (
  feature text primary key,

  -- 하루 몇 번까지 (한국시간 자정에 되살아난다)
  daily_limit integer not null check (daily_limit >= 0),
  -- 분당 몇 번까지. 무료 등급의 진짜 벽은 하루가 아니라 분당이다
  per_minute_limit integer not null check (per_minute_limit >= 1),

  -- 끄면 그 기능은 AI 를 아예 안 부른다. 지우는 것과 다르다 — 지우면 상한이 없어져 통과된다
  enabled boolean not null default true,

  -- 이 숫자를 왜 이렇게 잡았나. 나중에 올릴지 내릴지 판단하는 사람이 읽는다
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table ai_call_budget enable row level security;

-- 읽기는 로그인한 사람. 「내가 지금 쓸 수 있나」는 화면이 말해야 하는 값이다
drop policy if exists ai_call_budget_select on ai_call_budget;
create policy ai_call_budget_select on ai_call_budget
  for select to authenticated using (true);

-- 쓰기 정책은 두지 않는다. 상한 변경은 관리자 화면이 서버에서만 한다 —
-- 브라우저가 직접 고칠 수 있으면 상한이 상한이 아니다
comment on table ai_call_budget is
  '기능별 AI 호출 상한. 줄이 없으면 상한을 모르는 것이고, 그때는 막지 않는다 (P0030 I07)';
comment on column ai_call_budget.enabled is
  'false 면 그 기능은 AI 를 안 부른다. 줄을 지우는 것과 다르다 — 지우면 통과된다';

-- 실측에 맞춘 첫 값. 하루 신규 콘텐츠가 7.3건이므로 CI 쪽은 넉넉해도 이 정도면 남는다.
-- 분당은 무료 등급 한도(모델당 5회)를 여러 기능이 나눠 쓰는 것을 감안해 낮게 잡았다.
insert into ai_call_budget (feature, daily_limit, per_minute_limit, note) values
  ('ci-discover',         50,  2, '하루 새 떡상이 평균 2.5건. 밀린 것 따라잡기는 버튼으로 나눠 돈다'),
  ('ci-discover-cluster', 20,  2, '주제 수만큼. 새로 물은 것이 없으면 아예 안 부른다'),
  ('ci-gemini',          100,  2, '분류·검증·영상이해. 신규 7.3건 × 단계 4회면 30회 안팎'),
  ('ci-verify',           50,  2, ''),
  ('ai-chat',            200,  5, '사람이 직접 누르는 자리라 분당을 조금 넉넉히'),
  ('meeting_extract',    100,  3, '회의 노트. 몰아서 올리는 날이 있다'),
  ('meeting_summarize',  100,  3, ''),
  ('crm',                200,  3, 'CRM 열두 갈래가 나눠 쓴다')
on conflict (feature) do nothing;
