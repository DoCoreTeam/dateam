-- 223_api_key_usage_and_ratelimit.sql
--
-- 개발자센터 사내 전환 — 사용량을 실제로 세고, 요청 한도를 실제로 지킨다.
--
-- 왜 필요한가 (실측 v0.7.616):
--   ① api_keys.request_count 가 **영원히 1** 이었다.
--      lib/publicApiAuth.ts 의 select 가 request_count 를 안 가져오는데
--      (data.request_count ?? 0) + 1 로 덮어썼다 — 운영 DB 최댓값이 정확히 1 이다.
--      읽어서 더하는 방식은 동시 요청에서도 어차피 틀린다. **DB 가 세게 한다.**
--   ② 문서는 분당 60회·429·Retry-After 를 약속하는데 세는 코드가 어디에도 없었다.
--      Vercel 은 서버리스라 프로세스 메모리 카운터가 성립하지 않는다(인스턴스가 여럿).
--      Redis 를 새로 들이지 않고, 요청마다 어차피 읽는 이 테이블 옆에 분 단위 창을 둔다.
--
-- 되돌리기: 아래 3개를 지우면 된다 (api_keys 의 기존 컬럼은 건드리지 않는다).
--   drop function if exists public.record_api_key_hit(uuid, integer);
--   drop table if exists public.api_key_usage_minute;
--
-- 평문 임시 비밀번호 폐기는 **되돌릴 수 없는 데이터 변경**이라 224 로 분리했다(M-12).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 분 단위 사용량 창 — 한도 판정의 근거
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.api_key_usage_minute (
  key_id       uuid        not null references public.api_keys(id) on delete cascade,
  minute_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key_id, minute_start)
);

comment on table public.api_key_usage_minute is
  '키별 분 단위 호출 수. record_api_key_hit() 가 원자적으로 올린다. 오래된 행은 같은 함수가 치운다.';

-- 정리용 — 지난 창을 지울 때 쓴다
create index if not exists api_key_usage_minute_minute_idx
  on public.api_key_usage_minute (minute_start);

-- 서비스 롤만 접근한다(공개 API 경로는 전부 service role 로 돈다).
-- RLS 를 켜고 정책을 하나도 두지 않으면 anon/authenticated 는 아무것도 못 읽는다.
alter table public.api_key_usage_minute enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 한 번의 호출을 기록하고, 지금 이 분의 잔량을 돌려준다
--
--    읽고→더하고→쓰는 왕복을 앱에서 하지 않는다. insert … on conflict do update 한 번이면
--    동시 요청에서도 정확하고, 왕복도 1회다.
--
--    반환: (hits_this_minute, total_hits, minute_start)
--      hits_this_minute — 이번 분에 몇 번째인가 (이 호출 포함)
--      total_hits       — 누적 (api_keys.request_count 와 같은 값)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_api_key_hit(
  p_key_id  uuid,
  p_keep_minutes integer default 120
)
returns table (hits_this_minute integer, total_hits integer, minute_start timestamptz)
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
  returning hits into v_hits;

  -- 누적과 마지막 사용 시각도 같은 왕복에서 — 앱의 fire-and-forget 을 없앤다
  -- (Next 14 의 fire-and-forget 은 응답과 함께 사라져 기록이 조용히 0건이 된다)
  update public.api_keys
     set request_count = coalesce(request_count, 0) + 1,
         last_used_at  = now()
   where id = p_key_id
  returning request_count into v_total;

  -- 지난 창 정리 — 별도 크론을 만들지 않는다. 한도 판정에 쓰는 창만 남으면 된다.
  delete from public.api_key_usage_minute
   where minute_start < v_minute - make_interval(mins => greatest(p_keep_minutes, 5));

  return query select v_hits, coalesce(v_total, 0), v_minute;
end;
$$;

comment on function public.record_api_key_hit(uuid, integer) is
  '공개 API 호출 1건을 기록하고 이번 분의 누적 횟수를 돌려준다. 한도 판정의 유일한 근거.';

revoke all on function public.record_api_key_hit(uuid, integer) from public, anon, authenticated;
