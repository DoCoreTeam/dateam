-- 299 포털 서비스 신청 상태를 표에 둔다
--
-- ## 왜 필요한가
--
-- 공공데이터포털은 키 하나로 여섯 서비스를 주지만 **활용 신청은 서비스마다 따로** 한다.
-- 신청은 포털에서 사람이 하는 일이라 우리가 대신 못 하고, 신청했는지도 우리가 알 수 없다.
-- 그래서 「신청했다」를 사람이 적어 두는 자리가 필요하다.
--
-- 적어 두면 화면이 두 가지를 갈라 말할 수 있다:
--   신청 안 함  → 포털에서 신청해야 열린다 (기다려도 안 열린다)
--   신청했는데 안 씀 → 우리 코드가 아직 안 부른다
-- 지금은 코드 상수 `inUse` 하나뿐이라 이 둘이 화면에서 같아 보인다.
--
-- ## 왜 env 가 아닌가
--
-- 신청 상태는 조직마다 다르고 사람이 바꾼다. env 에 두면 바꿀 때마다 배포가 필요하고,
-- 그러면 아무도 안 바꿔서 화면이 영영 틀린 말을 한다.
--
-- ## 기본키에 org_id 를 넣는다
--
-- 서비스 id 는 여섯 개로 **고정된 이름**이다. 기본키를 service_id 하나로 두면
-- bidPublicInfo 를 가질 수 있는 조직이 저장소 전체에 하나뿐이 된다 —
-- 이 저장소가 rfp_anomaly_rules 에서 이미 한 실수다(마이그레이션 300 이 고쳤다).

create table if not exists public.rfp_g2b_service_states (
  org_id uuid not null references public.rfp_orgs(id) on delete cascade,
  service_id text not null,
  applied boolean not null default false,
  applied_at timestamptz,
  -- 신청 번호나 메모. 비밀은 안 적는다
  note text,
  updated_at timestamptz not null default now(),
  primary key (org_id, service_id)
);

-- 표를 만들면 **같은 판에서** 켠다. 나중으로 미루면 그 사이에 열린 표가 된다
alter table public.rfp_g2b_service_states enable row level security;

-- 대상에 public 을 쓰지 않는다. 로그인 안 한 사람이 볼 이유가 없다
drop policy if exists rfp_g2b_service_states_read on public.rfp_g2b_service_states;
create policy rfp_g2b_service_states_read on public.rfp_g2b_service_states
  for select to authenticated
  using (org_id in (select rfp_my_orgs()));

-- 고치는 것은 관리자만. 판정을 창구가 아니라 표가 한다
drop policy if exists rfp_g2b_service_states_admin on public.rfp_g2b_service_states;
create policy rfp_g2b_service_states_admin on public.rfp_g2b_service_states
  for all to authenticated
  using (org_id is not null and rfp_is_admin(org_id))
  with check (org_id is not null and rfp_is_admin(org_id));

-- 익명에게는 아무 권한도 주지 않는다. GRANT 와 RLS 는 다른 벽이라 둘 다 닫는다
revoke all on public.rfp_g2b_service_states from anon;
grant select, insert, update, delete on public.rfp_g2b_service_states to authenticated;

-- 켜져 있어야 한다. 꺼져 있으면 여기서 멈춘다
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'rfp_g2b_service_states') then
    raise exception 'rfp_g2b_service_states 의 RLS 가 꺼져 있다';
  end if;
end $$;
