-- 220_meeting_note_crm_visibility_fix.sql
-- 216 의 SELECT 정책이 회의노트 목록을 통째로 죽였다 — 권한 경로를 함수로 내린다.
--
-- **무엇이 잘못됐나.** 216 은 정책 안에서 `crm_meeting` · `crm_member` 를 직접 조인했다.
-- 그 두 표는 Prisma 가 관리하는 CRM 표라 `authenticated` 롤에 SELECT 권한이 없다.
-- 정책은 **읽는 사람의 권한으로** 평가되므로, 조건이 참이든 거짓이든 그 전에
--   `permission denied for table crm_meeting`
-- 로 질의 자체가 죽는다. 그래서 **자기 회의노트를 읽는 것까지** 실패했다
-- (실측: /meeting-notes 가 '회의노트를 불러오지 못했습니다'로 통째로 비었다).
--
-- 정적 검사·단위 테스트는 전부 초록이었고, 마이그레이션 직후 확인도 **서비스 롤**로 세어
-- 10건이 살아 있다고 나왔다 — 서비스 롤은 RLS 를 우회한다. 실사용자 권한으로 화면을
-- 열어 봤을 때만 보이는 종류의 결함이다(완료 조건 E-1).
--
-- **왜 GRANT 로 풀지 않나.** `grant select on crm_meeting to authenticated` 면 지금 화면은
-- 살아나지만, 그 순간 **모든 로그인 사용자가 남의 워크스페이스 미팅을 통째로 읽을 수 있다**
-- (CRM 표는 앱 계층에서 워크스페이스를 거르고 RLS 가 없다). 고치려던 것보다 큰 구멍이다.
--
-- 그래서 판정만 하는 **SECURITY DEFINER 함수**로 내린다. 함수는 소유자 권한으로 돌아
-- 표 권한이 필요 없고, 밖으로 나가는 것은 boolean 하나뿐이다.

create or replace function public.meeting_note_shared_to_crm(p_note_id uuid)
returns boolean
language sql
stable
security definer
-- search_path 를 고정한다 — 안 하면 호출자가 같은 이름의 표를 앞에 놓아 함수를 속일 수 있다
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from "crm_meeting" m
    join "crm_member" cm on cm."workspaceId" = m."workspaceId"
    where m."noteId" = p_note_id::text
      and m."deletedAt" is null
      and cm."hostUserId" = auth.uid()::text
      and cm."deletedAt" is null
  );
$$;

comment on function public.meeting_note_shared_to_crm(uuid) is
  '이 회의노트를 원본으로 삼은 CRM 미팅이 있고, 지금 사용자가 그 워크스페이스의 살아있는 멤버인가. RLS 정책 전용 — boolean 만 돌려준다.';

-- 아무나 부를 수 있게 두지 않는다. 로그인 사용자만, 그리고 자기 판정만 나온다(auth.uid() 고정).
revoke all on function public.meeting_note_shared_to_crm(uuid) from public;
grant execute on function public.meeting_note_shared_to_crm(uuid) to authenticated;

-- 정책은 216 과 **뜻이 같다**. 세 번째 갈래의 조인만 함수 호출로 바뀐다.
drop policy if exists meeting_notes_select on meeting_notes;
create policy meeting_notes_select on meeting_notes
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.deleted_at is null
    )
    or (
      visibility = 'crm'
      and public.meeting_note_shared_to_crm(id)
    )
  );
