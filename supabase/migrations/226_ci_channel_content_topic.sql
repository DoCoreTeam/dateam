-- 226_ci_channel_content_topic.sql
-- 채널의 «성격»과 그 채널 게시물의 «주제»를 다른 칸으로 나눈다.
--
-- 왜(2026-08-27 실측):
--   검토 대기 634건 중 629건(99.2%)이 채널 하나(「장사의 신」)였다. 634건 전부가
--   같은 사유·같은 확신도(0.60)·같은 2차 후보(「교육」 630건)였다. 이유는 하나다 —
--   채널에 고정으로 붙은 태그(장사의신·은현장·골목식당)가 게시물마다 같은 신호를 내고,
--   그 신호(「음식」)와 제목 규칙(「교육」)이 갈려 **매 게시물마다 사람을 불렀다.**
--
--   근본 원인은 축이 하나뿐이라는 것이었다. ci_channels.topic_id 는 «이 채널은 무엇인가»
--   (「인물·블로그」)를 담는데, 분류는 «이 채널의 영상은 무슨 주제인가»(「음식」)를 물어야 한다.
--   둘이 같은 칸을 쓰니 어긋남이 상시화됐다. 실제로 「인물·블로그」가 붙은 **게시물은 5건**뿐이다.
--
-- 이 칸이 정해지면 분류는 그 채널의 L0/L2 충돌에서 사람을 부르지 않는다.
-- 즉 사용자가 카드 한 장에 한 번 답하면 그 채널은 다시 묻지 않는다.
--
-- 추가 전용(M-4): 기존 컬럼을 한 줄도 건드리지 않는다. 되돌리기 = 이 칸을 null 로 비우는 것.

alter table ci_channels
  add column if not exists content_topic_id uuid references ci_topics(id) on delete set null;

comment on column ci_channels.content_topic_id is
  '이 채널 게시물의 기본 주제. topic_id(채널 성격)와 다른 축이다. 사람이 검토 카드에서 답하면 채워진다';

-- 누가 언제 정했는지 — 규칙은 앞으로 들어올 모든 게시물을 지배하므로 출처가 남아야 한다
alter table ci_channels
  add column if not exists content_topic_set_at timestamptz,
  add column if not exists content_topic_set_by uuid;

-- 분류가 채널을 읽을 때 이 칸을 함께 가져간다 — 조회 축은 이미 (workspace_id, id) 라 새 인덱스는 없다
