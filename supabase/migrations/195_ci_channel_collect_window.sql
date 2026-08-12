-- 195_ci_channel_collect_window.sql
-- 채널별 수집 기간 기준
--
-- 왜: "수집 실패"로 보이던 것의 상당수는 실패가 아니라 **범위 문제**였다.
-- RSS는 최근 15개가 상한이라 그 밖은 아예 못 본다.
-- 개수가 아니라 기간(최근 1개월·1년)으로 기준을 잡으면 사용자가 이해할 수 있고,
-- API 키가 있으면 그 기간까지 정확히 가져온다.

begin;

alter table ci_channels
  add column if not exists collect_window text not null default '1y';

alter table ci_channels drop constraint if exists ci_channels_collect_window_check;
alter table ci_channels add constraint ci_channels_collect_window_check
  check (collect_window in ('1m', '3m', '1y', 'all'));

comment on column ci_channels.collect_window is
  '이 채널에서 가져올 기간. API 키가 없으면 RSS 상한(15개)이 먼저 걸린다';

commit;
