-- 214_ci_channel_groups.sql — 채널별 보기의 서버 집계
--
-- 왜 필요한가 (사용자 지적 2026-08-18: "페이지 바꿀 때마다 채널만 달라지고 이게 맞는건가?"):
-- '채널별로 묶기'가 **페이지를 먼저 자른 뒤 그 안에서** 묶고 있었다.
-- 그래서 2페이지에는 그 100건에 우연히 담긴 채널 2곳만 보이고, 페이지를 넘기면 채널이 바뀐다.
-- 채널이 8곳인데 어느 페이지에서도 8곳을 볼 수 없다 — 묶는 목적(조망)이 통째로 사라진다.
--
-- 표준(AG Grid 서버사이드 모델·PrimeNG #15192가 같은 증상):
--   "페이지는 **최상위 그룹** 기준으로 나눈다. 그룹을 펴면 자식은 부모와 같은 페이지에 있다."
-- 즉 채널별 보기에서 페이지의 단위는 게시물이 아니라 **채널**이다.
--
-- 이 함수는 그 '최상위 그룹' 한 페이지를 만든다. 각 채널의 게시물은 펼 때 따로 불러온다.

create or replace function ci_channel_groups(
  p_workspace_id uuid,
  p_tab          text    default 'all',      -- 'all' | 'review' | 'failed'
  p_ids          uuid[]  default null,       -- 검색으로 좁힌 게시물 id (null이면 제한 없음)
  p_topic        uuid    default null,
  p_platform     text    default null,
  p_format       text    default null,
  p_limit        integer default 20,
  p_offset       integer default 0
)
returns table (
  channel_id        uuid,
  channel_name      text,
  item_count        bigint,
  top_outlier_index numeric,
  latest_at         timestamptz,
  total_groups      bigint          -- 전체 채널 수. 페이지 수를 화면이 계산할 수 있어야 한다
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select c.id, c.channel_id, c.published_at, c.first_seen_at,
           d.outlier_index
    from ci_contents c
    left join ci_content_derived d on d.content_id = c.id
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and (p_ids is null or c.id = any(p_ids))
      and (p_topic is null or c.topic_id = p_topic)
      and (p_platform is null or c.platform::text = p_platform)
      and (p_format is null or c.format::text = p_format)
      and (
        p_tab = 'all'
        or (p_tab = 'review' and c.review_state = 'pending')
        or (p_tab = 'failed' and c.ingest_status = 'failed')
      )
  ),
  grouped as (
    select m.channel_id,
           coalesce(ch.display_name, '채널 미확인') as channel_name,
           count(*)                                as item_count,
           max(m.outlier_index)                    as top_outlier_index,
           max(coalesce(m.published_at, m.first_seen_at)) as latest_at
    from matched m
    left join ci_channels ch on ch.id = m.channel_id
    group by m.channel_id, ch.display_name
  ),
  counted as (select count(*) as n from grouped)
  select g.channel_id, g.channel_name, g.item_count, g.top_outlier_index, g.latest_at,
         (select n from counted)
  from grouped g
  -- 배수가 잡힌 채널을 먼저, 그다음 건수 많은 순. 화면의 예전 정렬과 같은 규칙이다.
  order by (g.top_outlier_index is null), g.top_outlier_index desc nulls last, g.item_count desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function ci_channel_groups(uuid, text, uuid[], uuid, text, text, integer, integer) is
  '채널별 보기의 한 페이지. 페이지 단위는 게시물이 아니라 채널이다 — 게시물로 자르면 페이지마다 채널이 바뀌어 조망이 불가능해진다.';

revoke all on function ci_channel_groups(uuid, text, uuid[], uuid, text, text, integer, integer) from public;
grant execute on function ci_channel_groups(uuid, text, uuid[], uuid, text, text, integer, integer) to authenticated, service_role;
