-- 203_ci_topic_signals.sql
-- 주제 판정의 증거를 담을 자리 — 플랫폼 신호 · 채널 정체성 · 판정 근거
--
-- 왜: 수집함 321건이 전부 "요리"로 분류됐다. 원인은 분류 알고리즘이 아니라 **증거 부재**였다.
--   ① YouTube가 videos.list 응답으로 이미 주는 categoryId·topicCategories를 요청조차 안 했다
--      (part에 topicDetails가 없었다. 같은 호출이라 추가 쿼터 비용은 0이다)
--   ② ci_channels.description은 수집해 놓고 분류 쿼리가 읽지 않았다
--   ③ 그래서 판정할 근거가 제목 한 줄뿐이었고, 매칭에 실패하자 96.6%를 사람에게 넘겼다
--
-- 이 마이그는 "무엇을 보고 판단했는가"를 저장할 칸을 만든다. 판정 로직은 코드에 있다.
-- (진단 근거: docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md)

begin;

-- ── 콘텐츠: 플랫폼이 주는 주제 신호 ─────────────────────────────
-- 받고도 버리던 값이다. 추측으로 채우지 않는다 — 플랫폼이 안 주면 비운다.
alter table ci_contents
  -- 플랫폼 원문 카테고리. YouTube categoryId('22'), 다른 플랫폼은 각자의 코드.
  -- 숫자로 두지 않는다 — 플랫폼마다 체계가 달라 text가 유일하게 안전한 공통형이다.
  add column if not exists platform_category text,
  -- topicCategories 등 주제 신호. Wikipedia URL의 마지막 조각만 남긴다('Food','Sport').
  add column if not exists topic_signals text[] not null default '{}',
  -- 무엇을 보고 그렇게 판정했는지. 화면이 사용자에게 그대로 보여준다.
  -- 예전엔 ci_jobs.payload에 남겨 목록에서 볼 수 없었다 — 근거가 안 보이니
  -- 사용자는 "이거 하드코딩이니 AI니"를 물을 수밖에 없었다.
  add column if not exists topic_basis jsonb not null default '{}';

create index if not exists idx_ci_contents_signals
  on ci_contents using gin (topic_signals);

comment on column ci_contents.platform_category is
  '플랫폼 원문 카테고리 코드. YouTube는 snippet.categoryId. 수집 경로가 안 주면 null';
comment on column ci_contents.topic_signals is
  '플랫폼이 준 주제 신호(topicDetails.topicCategories의 말단). 추론값이 아니라 원문';
comment on column ci_contents.topic_basis is
  '{ rungs: [{level,verdict,detail}], decidedBy, agreement } — 판정 근거. 화면 표시용 SSOT';

-- ── 채널: 정체성 판정 결과 ──────────────────────────────────────
-- 왜 채널인가: 검토 단위를 콘텐츠에서 채널로 올리는 것이 이번 재설계의 핵심이다.
-- 채널 1개를 확정하면 그 채널 콘텐츠 전량이 확정된다(실측: 추성훈 1회 = 311건).
-- topic_id 컬럼은 186에 이미 있으나 14개 채널 전부 NULL이었다 — 채우는 경로가 없었다.
alter table ci_channels
  add column if not exists topic_confidence numeric(4,3),
  add column if not exists topic_source ci_topic_source,
  -- 집계 근거: { dominantCategory, agreement, topSignals[], keywordProfile[], sampleSize }
  add column if not exists identity jsonb not null default '{}',
  add column if not exists identity_at timestamptz;

comment on column ci_channels.identity is
  '채널 신호 집계 결과. agreement=최빈 카테고리 비율(1.0이면 전 콘텐츠가 같은 카테고리)';
comment on column ci_channels.topic_source is
  'auto=신호 집계로 판정, ai_verified=AI 판정, user=사람이 확정. null=아직 판정 안 함';

-- ── 주제: 신호 규칙 ─────────────────────────────────────────────
-- 기존 include/exclude는 제목·설명 텍스트를 본다. signal은 플랫폼 신호를 본다.
-- 축이 다르므로 규칙 종류를 늘린다 — 별도 테이블을 만들면 규칙이 두 곳으로 갈린다.
do $$ begin
  alter table ci_topic_rules drop constraint if exists ci_topic_rules_kind_check;
  alter table ci_topic_rules
    add constraint ci_topic_rules_kind_check
    check (kind in ('include','exclude','signal','category'));
exception when others then null;
end $$;

comment on column ci_topic_rules.kind is
  'include/exclude=제목·설명 텍스트 매칭, signal=topic_signals 매칭, category=platform_category 매칭';

commit;
