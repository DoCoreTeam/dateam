-- 301 적중 상태에 'adopted' 를 더한다
--
-- ## 무엇이 잘못돼 있었나
--
-- `adopt-ports.ts` 의 `markAdopted` 가 케이스를 만든 뒤 적중을 `status='adopted'` 로 바꾼다.
-- 그런데 표의 CHECK 제약은 `new·opened·dismissed` 셋만 허용한다. 그래서 그 UPDATE 는
-- **늘 실패**했고, supabase-js 는 제약 위반을 던지지 않고 돌려주는데 부르는 쪽이 그 값을 안 읽어
-- 아무도 몰랐다.
--
-- 증상은 「케이스로 만들었는데 그 공고가 목록에 계속 있다」로 나온다. 사용자는 단추가
-- 안 먹은 줄 알고 다시 누르고, 그러면 같은 공고로 케이스가 또 생긴다.
-- 실측 2026-09-30: rfp_radar_hits 51행이 전부 `new`, `adopted` 는 0행.
--
-- ## 왜 낱말을 더하나 — `opened` 를 쓰면 되지 않나
--
-- 안 된다. 둘은 다른 사실이다.
--   opened  = 사람이 열어 봤다 (아직 아무것도 안 정했다)
--   adopted = 케이스가 됐다 (이 적중은 할 일이 끝났다)
-- 하나로 뭉치면 「열어만 본 것」과 「이미 분석 중인 것」을 목록이 못 가른다.
--
-- ## 표를 만들지 않는다
--
-- 247 이 만든 표의 CHECK 제약만 넓힌다. RLS 와 정책은 손대지 않는다(끝에서 다시 확인한다).

begin;

alter table public.rfp_radar_hits drop constraint if exists rfp_radar_hits_status_check;
alter table public.rfp_radar_hits add constraint rfp_radar_hits_status_check
  check (status = any (array['new'::text, 'opened'::text, 'dismissed'::text, 'adopted'::text]));

commit;

-- 켜져 있어야 한다. 제약만 건드렸지만 확인은 공짜다
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'rfp_radar_hits') then
    raise exception 'rfp_radar_hits 의 RLS 가 꺼져 있다';
  end if;
end $$;
