-- 260_public_request_throttle.sql — 로그인 없이 부를 수 있는 창구에 속도 제한을 둔다
--
-- 왜 (실측 2026-09-20):
--   라우트 357개를 전수로 훑어 보니 **인증을 하나도 안 거치는 쓰기 창구가 하나** 있었다.
--     POST /api/public/api-access — API 사용 신청 폼
--   이 창구는 서비스롤로 api_access_requests 에 행을 넣는다. 즉 아무나, 몇 번이든,
--   관리자 대기열에 행을 쌓을 수 있었다. 키로 부르는 /api/public/v1/* 은 분당 한도가
--   있는데(마이그 223) 정작 **키가 필요 없는 쪽에는 아무 제한이 없었다.**
--
-- 왜 새 표인가: 223 의 api_key_usage_minute 은 키 id 를 외래키로 묶는다. 익명 요청에는
--   키가 없다. 그래서 문자열 바구니(bucket) 하나로 세는 표를 따로 둔다 — 앞으로 생길
--   다른 익명 창구도 같은 표를 쓴다.
--
-- 되돌리기:
--   drop function if exists public.record_public_hit(text, integer, integer);
--   drop table if exists public.public_request_throttle;

create table if not exists public.public_request_throttle (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

comment on table public.public_request_throttle is
  '익명 창구의 시간창별 호출 수. record_public_hit() 가 원자적으로 올리고 지난 창을 치운다. bucket 은 <창구>:<식별자 해시> 형식이고 원본 주소는 저장하지 않는다.';

create index if not exists public_request_throttle_window_idx
  on public.public_request_throttle (window_start);

-- 서비스롤만 만진다. RLS 를 켜고 정책을 하나도 두지 않으면 anon·authenticated 는 못 읽는다.
-- (259 에서 anon 의 쓰기 권한도 스키마 전체에서 회수했다)
alter table public.public_request_throttle enable row level security;

-- 방벽을 둘로 둔다. RLS 는 «행을 볼 수 있나» 를, GRANT 는 «표를 열 수 있나» 를 본다.
-- 259 는 anon 의 SELECT 를 스키마 전체에서 남겨 뒀다(/develop 의 브랜딩 조회 때문에).
-- 이 표는 그 예외에 해당하지 않으므로 여기서 따로 거둔다.
revoke all on table public.public_request_throttle from anon, authenticated;

-- 한 번의 호출을 기록하고 이번 창의 누계를 돌려준다.
--
-- 읽고→더하고→쓰는 왕복을 앱에서 하지 않는다. insert … on conflict 한 번이면
-- 동시 요청에서도 정확하고 왕복도 1회다 (223 과 같은 모양).
drop function if exists public.record_public_hit(text, integer, integer);
create function public.record_public_hit(
  p_bucket         text,
  p_window_seconds integer default 3600,
  p_keep_windows   integer default 24
)
-- 반환 칼럼 이름을 표의 칼럼과 다르게 둔다.
-- returns table 의 이름은 plpgsql 안에서 변수가 되고, 같은 이름이면
-- `on conflict (window_start)` 가 «변수냐 칼럼이냐» 로 갈려 실행이 죽는다(실측).
returns table (out_hits integer, out_window_start timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  v_window := to_timestamp(
    floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1)
  );

  insert into public.public_request_throttle as t (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
  do update set hits = t.hits + 1
  returning t.hits into v_hits;

  -- 지난 창을 치운다 — 청소 크론을 따로 두지 않기 위해 쓰는 김에 같이 한다
  delete from public.public_request_throttle
  where window_start < v_window - make_interval(secs => greatest(p_window_seconds, 1) * greatest(p_keep_windows, 1));

  return query select v_hits, v_window;
end;
$$;

revoke all on function public.record_public_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_public_hit(text, integer, integer) to service_role;
