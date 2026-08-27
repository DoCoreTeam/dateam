-- 225_fix_record_api_key_hit_ambiguity.sql
--
-- 223 의 `record_api_key_hit` 가 실행 시점에 죽었다. 실DB 에서 부르고서야 드러났다:
--   ERROR: column reference "minute_start" is ambiguous
--
-- 원인: `returns table (…, minute_start timestamptz)` 의 OUT 이름이
--   `api_key_usage_minute.minute_start` 컬럼과 같은 이름이라, plpgsql 이
--   `on conflict (key_id, minute_start)` 의 minute_start 를 어느 쪽으로 읽을지 못 정한다.
--   **CREATE FUNCTION 은 성공한다** — 문법은 맞고, 충돌은 실행할 때만 난다.
--   그래서 마이그레이션은 초록이었고 함수는 부르는 순간 100% 실패했다.
--
-- 고치는 법: OUT 이름을 컬럼과 겹치지 않게 바꾼다. OUT 이름 변경은 CREATE OR REPLACE 로
--   안 되므로(포스트그레스가 거부한다) 먼저 지우고 다시 만든다.
--
-- 되돌리기: drop function public.record_api_key_hit(uuid, integer);

drop function if exists public.record_api_key_hit(uuid, integer);

create function public.record_api_key_hit(
  p_key_id  uuid,
  p_keep_minutes integer default 120
)
returns table (hits_this_minute integer, total_hits integer, window_start timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_hits   integer;
  v_total  integer;
begin
  insert into public.api_key_usage_minute (key_id, minute_start, hits)
  values (p_key_id, v_minute, 1)
  on conflict (key_id, minute_start)
  do update set hits = public.api_key_usage_minute.hits + 1
  returning public.api_key_usage_minute.hits into v_hits;

  -- 누적과 마지막 사용 시각도 같은 왕복에서 — 앱의 fire-and-forget 을 없앤다
  update public.api_keys
     set request_count = coalesce(request_count, 0) + 1,
         last_used_at  = now()
   where id = p_key_id
  returning public.api_keys.request_count into v_total;

  -- 지난 창 정리 — 별도 크론을 만들지 않는다
  delete from public.api_key_usage_minute u
   where u.minute_start < v_minute - make_interval(mins => greatest(p_keep_minutes, 5));

  return query select v_hits, coalesce(v_total, 0), v_minute;
end;
$$;

comment on function public.record_api_key_hit(uuid, integer) is
  '공개 API 호출 1건을 기록하고 이번 분의 누적 횟수를 돌려준다. 한도 판정의 유일한 근거.';

revoke all on function public.record_api_key_hit(uuid, integer) from public, anon, authenticated;
