-- 213_ci_search_snippet.sql — 검색 결과가 "왜 걸렸는지"를 보여주게
--
-- 212의 구멍(실측으로 잡음): matched_in='caption'인데 snippet은 제목을 보여줬다.
-- '우니'로 검색하면 "우리 지수랑 PC방 다녀왔숨니다"가 나오는데, 제목 어디에도 '우니'가 없다.
-- 실제로는 설명문 138번째 글자에 있었지만 **사용자는 그걸 볼 방법이 없었다.**
-- 이유 없는 결과는 빈 결과보다 나쁘다 — 제품이 엉뚱한 걸 찾았다고 읽힌다.
--
-- 고침: 걸린 텍스트에서 **매칭 지점 주변**을 잘라 보여준다.

create or replace function ci_search_snippet(p_text text, p_query text, p_pad integer default 40)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    -- 부분 일치 지점이 있으면 그 주변을 잘라낸다
    when position(lower(btrim(p_query)) in lower(p_text)) > 0 then
      (case when position(lower(btrim(p_query)) in lower(p_text)) > p_pad + 1 then '…' else '' end)
      || substring(
           p_text
           from greatest(1, position(lower(btrim(p_query)) in lower(p_text)) - p_pad)
           for  length(btrim(p_query)) + p_pad * 2
         )
      || (case when position(lower(btrim(p_query)) in lower(p_text)) + length(btrim(p_query)) + p_pad <= length(p_text)
               then '…' else '' end)
    -- 어절 일치(FTS)로만 걸린 경우는 앞부분을 보여준다
    else left(p_text, p_pad * 3)
  end;
$$;

comment on function ci_search_snippet(text, text, integer) is
  '검색어 주변을 잘라낸 스니펫. 왜 이 결과가 나왔는지를 사용자가 눈으로 확인할 수 있어야 한다.';

create or replace function ci_search_contents(
  p_workspace_id uuid,
  p_query        text,
  p_limit        integer default 50
)
returns table (
  content_id  uuid,
  matched_in  text,
  snippet     text
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
    select c.id,
           case when c.title ilike q.like_pat then 'title' else 'caption' end,
           -- 걸린 쪽의 텍스트에서 잘라낸다. 제목에 없으면 설명문을 보여준다.
           ci_search_snippet(
             case when c.title ilike q.like_pat then c.title else c.caption end,
             q.raw)
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

    select m.content_id, 'transcript', ci_search_snippet(m.transcript, q.raw)
    from ci_content_media m
      join ci_contents c on c.id = m.content_id
      cross join q
    where q.raw is not null
      and m.workspace_id = p_workspace_id
      and c.deleted_at is null
      and m.transcript is not null
      and (m.transcript ilike q.like_pat or to_tsvector('simple', m.transcript) @@ q.ts)

    union

    select m.content_id, 'on_screen_text',
           ci_search_snippet(array_to_string(m.on_screen_text, ' / '), q.raw)
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

revoke all on function ci_search_contents(uuid, text, integer) from public;
grant execute on function ci_search_contents(uuid, text, integer) to authenticated, service_role;
revoke all on function ci_search_snippet(text, text, integer) from public;
grant execute on function ci_search_snippet(text, text, integer) to authenticated, service_role;
