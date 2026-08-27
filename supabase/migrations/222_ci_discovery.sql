-- 222_ci_discovery.sql — "왜 잘됐나"를 채점에서 발견으로
--
-- 왜 이 표가 생겼나 (실측 2026-08-27):
--   ci_patterns 는 lib/ci/analysis/patterns.ts 에 **하드코딩된 규칙 7개**(숫자·질문형·괄호·
--   20자·60초·1~3분·주말)를 데이터에 대조해 점수를 매기는 표였다. 그 결과 "성공 공식"
--   617행이 전부 이 7문장의 중복이었고, 효과(lift)는 1.21~1.25 — 근거 104건으로
--   "통계적으로 확실하게 쓸모없음"을 증명한 상태였다. 게다가 617행 전부 is_archived=true 라
--   화면 쿼리(is_archived=false)에는 0건이 떴다.
--
--   근본 결함은 통계가 아니라 **답의 집합이 7개로 고정**된 것이다. 콘텐츠가 잘되는 이유는
--   소재의 시의성·등장 인물·썸네일의 표정·첫 3초·시리즈 맥락처럼 미리 적을 수 없다.
--
-- 바뀐 것: 가설을 사람이 미리 적지 않는다. **대조가 이유를 만든다.**
--   떡상 1건 vs 같은 채널·같은 포맷·비슷한 시기의 평범 3건을 AI가 읽고
--   "이 1건만 가진 것"을 자유 문장으로 쓴다. 서로 다른 채널 3곳 이상에서 반복된 것만 승격한다.
--
-- ci_patterns 는 **지우지 않는다** — 읽는 코드가 아직 있고, 폐기는 그 코드를 옮긴 뒤에 한다.
-- (추가 전용 원칙 M-4. 이 마이그레이션은 기존 표를 한 줄도 건드리지 않는다.)

create table if not exists ci_discoveries (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references ci_workspaces(id) on delete cascade,
  -- 주제는 삭제돼도 발견 자체는 남는다(무엇을 발견했는지는 사실이다)
  topic_id        uuid references ci_topics(id) on delete set null,

  -- AI 가 쓴 문장 그대로. 목록에서 고르는 것이 아니라 발견한 것이다.
  statement       text not null,
  -- 사후 분류일 뿐이다. 판정을 이 값으로 하지 않는다.
  kind            text not null default 'other'
                  check (kind in ('hook','subject','format','timing','presentation','other')),

  -- 승격 근거. 둘 다 화면에 반드시 병기된다(설계서 §4.3)
  evidence_count  integer not null default 0,
  channel_count   integer not null default 0,

  computed_at     timestamptz not null default now(),
  is_archived     boolean not null default false
);

-- 화면은 살아 있는 발견만, 널리 반복된 것부터 읽는다
create index if not exists idx_ci_discoveries_live
  on ci_discoveries (workspace_id, topic_id, channel_count desc, evidence_count desc)
  where is_archived = false;

create table if not exists ci_discovery_evidence (
  discovery_id  uuid not null references ci_discoveries(id) on delete cascade,
  content_id    uuid not null references ci_contents(id) on delete cascade,
  -- 이 콘텐츠에서 무엇을 보고 그렇게 말했는지. 근거를 눌렀을 때 보여 준다.
  observation   text,
  primary key (discovery_id, content_id)
);

create index if not exists idx_ci_discovery_evidence_content
  on ci_discovery_evidence (content_id);

alter table ci_discoveries enable row level security;
alter table ci_discovery_evidence enable row level security;

drop policy if exists ci_discoveries_select on ci_discoveries;
create policy ci_discoveries_select on ci_discoveries
  for select using (ci_is_member(workspace_id));

drop policy if exists ci_discoveries_update on ci_discoveries;
create policy ci_discoveries_update on ci_discoveries
  for update using (ci_can_write(workspace_id)) with check (ci_can_write(workspace_id));

-- 근거는 부모(발견)의 워크스페이스를 따른다 — ci_pattern_evidence 와 같은 모양
drop policy if exists ci_discovery_evidence_select on ci_discovery_evidence;
create policy ci_discovery_evidence_select on ci_discovery_evidence
  for select using (exists (
    select 1 from ci_discoveries d
    where d.id = ci_discovery_evidence.discovery_id and ci_is_member(d.workspace_id)
  ));

comment on table ci_discoveries is
  '대조로 발견한 "왜 잘됐나". 하드코딩 규칙(ci_patterns)의 대체물 — 서로 다른 채널 3곳 이상 반복만 승격';
comment on table ci_discovery_evidence is
  '발견의 근거 콘텐츠. observation 은 그 콘텐츠에서 실제로 본 것';
