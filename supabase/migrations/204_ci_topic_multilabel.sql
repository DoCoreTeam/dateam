-- 204_ci_topic_multilabel.sql
-- 콘텐츠 하나에 주제 하나는 무리다 — 부 주제를 붙인다
--
-- 왜: 추성훈 채널 311건 안에 Entertainment 132 · Lifestyle 79 · Food 71 · Film 22가 섞여 있다.
--   단일 topic_id는 이 중 하나를 고르라고 강요하고, 고르지 못하면 검토 큐로 보낸다.
--   실제로는 "먹방이면서 여행"인 콘텐츠가 정상이다.
--
-- 왜 배열인가: 조인 테이블을 만들면 RLS 정책 · 삭제 연쇄 · 정합성 트리거가 따라온다.
--   부 주제는 검색·필터에만 쓰고 통계는 주 주제(topic_id)로만 낸다 — 그 정도 쓰임에
--   테이블 하나를 더 두는 것은 과설계다. uuid[] + GIN이면 `@>` 검색이 그대로 된다.

begin;

alter table ci_contents
  -- 주 주제(topic_id)를 제외한 나머지. 통계 모집단은 여전히 topic_id 하나로 센다.
  add column if not exists secondary_topic_ids uuid[] not null default '{}';

create index if not exists idx_ci_contents_secondary_topics
  on ci_contents using gin (secondary_topic_ids);

comment on column ci_contents.secondary_topic_ids is
  '부 주제. 검색·필터에만 쓴다. 통계·비교는 topic_id(주 주제)로만 — 한 콘텐츠가 여러 모집단에 중복 계수되면 배수가 망가진다';

-- 주 주제가 부 주제에도 들어가면 화면에 같은 이름이 두 번 나온다.
-- 애플리케이션에서 걸러도 되지만, 데이터가 스스로 지키게 둔다.
do $$ begin
  alter table ci_contents
    add constraint ci_contents_secondary_excludes_primary
    check (topic_id is null or not (topic_id = any (secondary_topic_ids)));
exception when duplicate_object then null;
end $$;

commit;
