-- 192_ci_content_keywords_channel_meta.sql
-- 콘텐츠 키워드 + 채널 메타 저장소
--
-- 왜: 상세를 열어도 썸네일과 제목뿐이었다. 설명문(caption)은 수집 경로가 없어 21건 전부 비었고,
-- 키워드는 저장할 칸조차 없었다. 채널은 구독자·설명·아바타를 한 번도 수집하지 않아
-- 채널 상세가 "—"만 보여주고 있었다. 볼 것을 만들려면 담을 곳부터 있어야 한다.

begin;

-- 콘텐츠: 플랫폼이 노출하는 키워드/태그. 없으면 빈 배열(추측으로 채우지 않는다).
alter table ci_contents
  add column if not exists keywords text[] not null default '{}';

create index if not exists idx_ci_contents_keywords
  on ci_contents using gin (keywords);

-- 채널: 소개문·게시물 수·메타 수집 시각.
-- 구독자 수는 이미 있는 subscriber_count를 쓰되, 공개 페이지 값은 반올림 표기라
-- subscriber_provenance='estimated'로 남긴다(정확한 값인 척하지 않는다).
alter table ci_channels
  add column if not exists description text,
  add column if not exists video_count integer,
  add column if not exists meta_fetched_at timestamptz,
  add column if not exists meta_error text;

comment on column ci_channels.subscriber_count is
  '구독자 수. provenance=platform이면 API 정확값, estimated면 공개 페이지의 반올림 표기(예: 137만)';

commit;
