-- 297 사용량 원장에 더하는 함수
--
-- ## 왜 함수인가
--
-- 원장은 (org_id, period, kind) 하나에 한 줄이고 그 줄의 값이 **누적**된다.
-- supabase-js 의 upsert 는 덮어쓰기라 더하기를 못 한다. 읽고 더해서 쓰면 두 호출이
-- 겹칠 때 하나가 사라진다 — AI 호출은 한 분석에서 아홉 번 동시에 난다.
-- 그래서 더하기를 한 문장으로 만든다: insert ... on conflict do update set units = units + excluded.units.
--
-- ## 왜 정책을 안 더하나
--
-- 쓰는 쪽은 워커의 createAdminClient(서비스롤)다. 서비스롤은 RLS 를 통째로 지나가므로
-- insert 정책을 더해도 아무도 그 정책을 안 지난다 — 죽은 무게이고, 읽는 사람에게는
-- 「사용자도 쓸 수 있다」는 잘못된 신호가 된다.
--
-- 사용자가 직접 못 쓰는 것이 옳다. 원장은 **한도를 재는 기록**이다.
-- 사용자가 자기 원장을 내릴 수 있으면 한도가 한도가 아니다.
--
-- ## 권한을 올리지 않는다
--
-- SECURITY DEFINER 가 아니다(기본값 INVOKER). 올리면 이 함수를 부를 수 있는 누구나
-- 남의 조직 원장을 건드릴 수 있고, 그것을 막으려면 함수 안에 또 권한 판정을 넣어야 한다.
-- INVOKER 로 두면 RLS 가 그대로 살아 서비스롤만 지나간다 — 판정이 한 곳에만 있다.
--
-- search_path 는 박는다. 안 박으면 부르는 쪽이 search_path 를 바꿔 같은 이름의
-- 가짜 표로 유도할 수 있다(보안 다섯 줄 중 넷째가 세는 것).
--
-- public 과 anon 의 실행 권한은 회수한다. 새 함수는 기본으로 PUBLIC 에 EXECUTE 가 붙는다.

create or replace function public.rfp_add_usage(
  p_org uuid,
  p_period text,
  p_kind text,
  p_units bigint,
  p_cost numeric
) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.rfp_usage_ledger (org_id, period, kind, units, cost_krw, updated_at)
  values (p_org, p_period, p_kind, p_units, p_cost, now())
  on conflict (org_id, period, kind) do update
    set units = public.rfp_usage_ledger.units + excluded.units,
        cost_krw = public.rfp_usage_ledger.cost_krw + excluded.cost_krw,
        updated_at = now();
$$;

revoke all on function public.rfp_add_usage(uuid, text, text, bigint, numeric) from public;
revoke all on function public.rfp_add_usage(uuid, text, text, bigint, numeric) from anon;

-- RLS 가 꺼져 있으면 여기서 멈춘다. 이 함수는 INVOKER 라 RLS 가 유일한 벽이다
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'rfp_usage_ledger') then
    raise exception 'rfp_usage_ledger 의 RLS 가 꺼져 있다';
  end if;
end $$;
