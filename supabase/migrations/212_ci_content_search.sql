-- 212_ci_content_search.sql — 게시물 통합 검색 (제목·설명·대사·화면 자막)
--
-- 왜 필요한가:
-- 209가 대사 전문에 FTS 인덱스를 걸었지만 **부르는 곳이 없었다.** 인덱스만 있고 검색이 없으면
-- 영상을 읽어 얻은 가장 큰 자산(대사·자막)에 사용자가 닿을 방법이 없다.
--
-- 왜 RPC인가:
-- 대사는 ci_content_media, 제목·설명은 ci_contents에 있다. 두 표에 걸친 OR 검색은
-- PostgREST 필터로 표현할 수 없다(임베드 필터는 AND로만 붙는다).
-- 검색 규칙이 화면마다 갈리지 않게 **DB에 한 벌**로 둔다.
--
-- 한국어는 형태소 사전이 없어 to_tsvector('simple')이 어절 단위로만 쪼갠다.
-- 그래서 FTS(어절 일치)와 ILIKE(부분 일치)를 함께 쓴다 — 어느 하나로는 놓치는 것이 많다.
--   "인생샷"  → FTS로 잡힘
--   "인생"    → FTS는 놓치고 ILIKE가 잡음

create or replace function ci_search_contents(
  p_workspace_id uuid,
  p_query        text,
  p_limit        integer default 50
)
returns table (
  content_id  uuid,
  matched_in  text,      -- 'title' | 'caption' | 'transcript' | 'on_screen_text'
  snippet     text       -- 어디서 걸렸는지 사용자가 보게. 빈 결과보다 나쁜 건 이유 없는 결과다
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select
      nullif(btrim(p_query), '')                 as raw,
      '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as like_pat,
      websearch_to_tsquery('simple', btrim(p_query)) as ts
  )
  select * from (
    -- 제목·설명 — 플랫폼이 준 것
    select c.id,
           case when c.title ilike q.like_pat then 'title' else 'caption' end,
           left(coalesce(nullif(c.title, ''), c.caption, ''), 200)
    from ci_contents c, q
    where q.raw is not null
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and (
        c.title ilike q.like_pat
        or c.caption ilike q.like_pat
        or to_tsvector('simple', coalesce(c.title,'') || ' ' || coalesce(c.caption,'')) @@ q.ts
      )

    union

    -- 대사 — 영상을 읽어야만 생기는 것. 숏폼에서는 사실상 유일한 본문이다
    select m.content_id, 'transcript',
           left(m.transcript, 200)
    from ci_content_media m
      join ci_contents c on c.id = m.content_id
      cross join q
    where q.raw is not null
      and m.workspace_id = p_workspace_id
      and c.deleted_at is null
      and m.transcript is not null
      and (
        m.transcript ilike q.like_pat
        or to_tsvector('simple', m.transcript) @@ q.ts
      )

    union

    -- 화면 자막 — 말은 없는데 글자만 있는 영상이 많다
    select m.content_id, 'on_screen_text',
           left(array_to_string(m.on_screen_text, ' / '), 200)
    from ci_content_media m
      join ci_contents c on c.id = m.content_id
      cross join q
    where q.raw is not null
      and m.workspace_id = p_workspace_id
      and c.deleted_at is null
      and array_to_string(m.on_screen_text, ' ') ilike q.like_pat
  ) hits
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function ci_search_contents(uuid, text, integer) is
  '게시물 통합 검색. 제목·설명(플랫폼이 준 것)과 대사·화면 자막(영상을 읽어 얻은 것)을 함께 본다. 어디서 걸렸는지(matched_in)를 함께 돌려준다.';

revoke all on function ci_search_contents(uuid, text, integer) from public;
grant execute on function ci_search_contents(uuid, text, integer) to authenticated, service_role;
