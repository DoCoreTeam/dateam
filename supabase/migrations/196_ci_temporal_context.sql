-- 196_ci_temporal_context.sql
-- 게시 시점의 맥락 — 언제·어느 계절·어느 나라·어떤 날씨였나
--
-- 왜: "평소 대비 9배"만으로는 **언제의 트렌드인지** 알 수 없다.
-- 여름에 통한 것을 겨울에 따라 하면 안 되고, 주말 밤에 통한 것을 평일 아침에 올리면 안 된다.
-- 게시 시각을 지역 기준으로 풀어 두면 "언제 통했나"를 물을 수 있다.

begin;

-- 채널의 국가 — 시간대·계절·날씨 판정의 출발점
alter table ci_channels
  add column if not exists country text;

comment on column ci_channels.country is
  'ISO 3166-1 alpha-2. 플랫폼이 주는 값만 넣는다(추정 금지)';

-- 콘텐츠의 게시 맥락. 파생값이므로 재계산 가능하고, 원본(published_at)은 그대로 둔다.
alter table ci_contents
  add column if not exists local_date date,
  add column if not exists season text,
  add column if not exists weekday smallint,
  add column if not exists day_part text,
  add column if not exists country_code text,
  -- 'channel' | 'language' — 어떤 근거로 국가를 정했는지. 추정이면 화면이 밝힌다
  add column if not exists country_source text,
  -- 지역을 몰라 UTC로 읽었으면 false
  add column if not exists region_known boolean not null default false,
  -- 날씨는 국가 대표 좌표 기준의 근사다. 한계를 값과 함께 남긴다
  add column if not exists weather jsonb;

alter table ci_contents drop constraint if exists ci_contents_season_check;
alter table ci_contents add constraint ci_contents_season_check
  check (season is null or season in ('spring', 'summer', 'autumn', 'winter'));

alter table ci_contents drop constraint if exists ci_contents_day_part_check;
alter table ci_contents add constraint ci_contents_day_part_check
  check (day_part is null or day_part in ('dawn', 'morning', 'afternoon', 'evening', 'night'));

-- "언제 통했나" 집계용
create index if not exists idx_ci_contents_season
  on ci_contents (workspace_id, season) where deleted_at is null and season is not null;
create index if not exists idx_ci_contents_daypart
  on ci_contents (workspace_id, day_part, weekday) where deleted_at is null;

commit;
