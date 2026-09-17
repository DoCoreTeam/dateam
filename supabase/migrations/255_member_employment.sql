-- 255 구성원 재직 기록
--
-- 왜 profiles 에 칸을 더하지 않고 표를 따로 두나 (사용자 지시 2026-09-17):
--   퇴사한 사람이 남긴 일일업무 주간보고 회의노트는 계속 살아 있어야 한다. profiles 행이
--   그대로 있어야 그 기록들이 이름을 잃지 않는다. 그래서 퇴사는 profiles 를 지우거나 비우는
--   일이 아니라, 옆에 「언제 들어와 언제 나갔나」를 적는 일이다.
--   지금 있는 deleted_at 은 뜻이 다르다 — 그건 「없던 것으로 친다」이고, 퇴사는 「있었고 나갔다」다.
--   같은 칸에 두 뜻을 담으면 목록에서 둘을 구분할 방법이 사라진다.
--
-- 입사일이 비어 있는 이유: 지금 전원의 입사일을 모른다. 빈칸으로 두고 구성원 상세에서
--   하나씩 채운다. 모르는 값을 오늘 날짜로 채우면 그 거짓이 영영 사실처럼 남는다.
--
-- 퇴사 여부는 resigned_on 이 있냐 없냐 하나로 정한다. 미래 날짜를 적어도 그 시점부터
--   자동으로 나가지지는 않는다 — 그러려면 매일 도는 배치가 있어야 하는데, 퇴사는 사람이
--   누르는 순간의 일이라 배치로 미룰 이유가 없다.
--
-- 되돌리기:
--   drop view if exists v_member_employment_status;
--   drop table if exists member_employment;

create table if not exists member_employment (
  user_id       uuid primary key references profiles(id) on delete cascade,
  -- 입사일. 지금은 대부분 비어 있고 구성원 상세에서 채운다
  hired_on      date,
  -- 퇴사일. null 이면 재직 중이다 (이 표의 유일한 재직 판정 근거)
  resigned_on   date,
  resign_reason text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_employment_dates_ordered
    check (resigned_on is null or hired_on is null or resigned_on >= hired_on)
);

-- 퇴사자만 훑는 조회가 목록의 기본 거르개다
create index if not exists idx_member_employment_resigned
  on member_employment (resigned_on)
  where resigned_on is not null;

-- 사유와 메모는 관리자만 본다. 재직 여부는 조직도에서 이미 보이는 사실이라 모두가 본다.
-- 뷰는 security invoker 를 켜지 않아 (기본값) 소유자 권한으로 돌고, 그래서 아래 표 정책을
-- 지나지 않는다 — 그것이 「칸만 골라 연다」의 구현이다.
create or replace view v_member_employment_status as
  select user_id, resigned_on, hired_on
  from member_employment;

revoke all on v_member_employment_status from anon;
grant select on v_member_employment_status to authenticated;

alter table member_employment enable row level security;

drop policy if exists member_employment_admin_read on member_employment;
create policy member_employment_admin_read on member_employment for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null));

drop policy if exists member_employment_admin_write on member_employment;
create policy member_employment_admin_write on member_employment for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null));
