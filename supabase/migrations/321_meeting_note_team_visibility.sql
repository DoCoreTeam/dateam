-- 321_meeting_note_team_visibility.sql
-- 회의노트 공개 범위를 「나만 보기」와 「팀 공개」 둘로 줄이고, 팀을 조직도로 판정한다.
--
-- 사용자 결정(2026-10-27):
--   "회의노트는 말그대로 본인만 보는거야 ... 팀공개는 조직도 기반에 팀에서 볼 수 있는건데 (상위 팀도)"
--
-- **무엇이 바뀌나.**
--   예전 'crm' 은 「이 노트를 가리키는 CRM 미팅이 있는 워크스페이스의 멤버 전원」이 읽었다(220).
--   조직도와 무관해서 다른 팀 사람도 읽었고, 「기록만」은 원본만 잠그고 사본은 팀에 보여 줬다.
--   이제 'team' 하나다. 작성자가 속한 부서가 읽는 사람의 관할(private.my_readable_dept_ids:
--   내 소속 부서 + 내가 맡은 노드의 하위 전부) 안에 있으면 읽는다. 대표(is_executive)는 전부 읽는다.
--
-- **왜 note.department_id 가 아니라 작성자의 소속을 보나.**
--   department_id 는 노트 편집 폼에서 사람이 고르는 칸이다(actions.ts). 그 칸으로 판정하면
--   다른 부서를 골라 그 부서에 공개하는 길이 생기고, 빈 칸(실측 77건 중 54건)은 아무에게도 안 보인다.
--   팀 공개의 「팀」은 작성자의 팀이므로 작성자의 조직 노드로 판정한다.
--   작성자의 팀은 소속 부서와 작성자가 맡은(head) 노드 둘 다다. 팀장의 노트는 그 팀원이 읽는다.
--   조직도에 아무 자리도 없는 작성자의 팀 공개는 대표만 읽는다(팀이 없으므로).
--
-- **왜 'crm' 을 지우지 않고 트리거로 받나.**
--   운영에 떠 있는 코드는 이 마이그레이션 뒤에도 배포 전까지 'crm' 을 쓴다.
--   CHECK 만 좁히면 그 코드의 공개 스위치가 제약 위반으로 죽는다.
--   BEFORE 트리거는 CHECK 보다 먼저 돌므로, 들어오는 'crm' 을 'team' 으로 바꿔 받는다.
--
-- **220 사고를 되풀이하지 않는다.** 정책 안에서 다른 표를 직접 읽으면 읽는 사람의 권한으로
--   평가돼 목록 전체가 죽을 수 있다. 판정은 SECURITY DEFINER 함수 하나로 내리고 boolean 만 낸다.
--
-- 되돌리기: 220 의 정책과 함수를 다시 만들고 CHECK 를 ('private','crm') 으로, 'team' 행을 'crm' 으로.
--   UPDATE·DELETE·INSERT 정책은 이 파일이 건드리지 않는다(언제나 본인만).

begin;

-- 1. 판정 함수: 이 작성자의 노트를 지금 사용자가 팀으로서 읽을 수 있나
create or replace function public.meeting_note_team_readable(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_executive()
      or exists (
        -- 작성자의 팀 = 소속 부서(person 노드의 부모) + 작성자가 맡은 노드(head)
        -- 실측 2026-10-27: 팀 공개 노트 20건의 작성자가 본부 head 로만 올라 있고 person 노드가 없었다
        select 1
        from (
          select p.parent_id as dept_id
          from public.org_nodes p
          where p.type = 'person' and p.user_id = p_author and p.parent_id is not null
          union
          select h.id
          from public.org_nodes h
          where h.head_user_id = p_author and h.type in ('department', 'role', 'company')
        ) author_team
        where author_team.dept_id = any(private.my_readable_dept_ids())
      );
$$;

comment on function public.meeting_note_team_readable(uuid) is
  '팀 공개 회의노트 판정: 작성자의 소속 부서가 지금 사용자의 관할(소속 부서와 맡은 노드의 하위) 안인가, 또는 대표인가. RLS 정책 전용, boolean 만 돌려준다.';

revoke all on function public.meeting_note_team_readable(uuid) from public;
revoke all on function public.meeting_note_team_readable(uuid) from anon;
grant execute on function public.meeting_note_team_readable(uuid) to authenticated;

-- 2. 값: 'crm' 을 'team' 으로 옮기고 CHECK 를 좁힌다
alter table public.meeting_notes drop constraint if exists meeting_notes_visibility_chk;

update public.meeting_notes set visibility = 'team' where visibility = 'crm';

alter table public.meeting_notes
  add constraint meeting_notes_visibility_chk
  check (visibility in ('private', 'team'));

comment on column public.meeting_notes.visibility is
  'private=본인+admin(기본) / team=작성자의 팀과 상위 팀장이 읽음(조직도). 읽기 전용 공개, 수정과 삭제는 언제나 본인만.';

-- 3. 배포 전 코드가 쓰는 옛 값 'crm' 을 받아 준다 (CHECK 보다 먼저 돈다)
create or replace function public.meeting_notes_visibility_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'crm' then
    new.visibility := 'team';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meeting_notes_visibility_normalize on public.meeting_notes;
create trigger trg_meeting_notes_visibility_normalize
  before insert or update of visibility on public.meeting_notes
  for each row execute function public.meeting_notes_visibility_normalize();

-- 4. SELECT 정책: 본인 / 관리자는 그대로, 세 번째 갈래만 조직도 판정으로 바꾼다
drop policy if exists meeting_notes_select on public.meeting_notes;
create policy meeting_notes_select on public.meeting_notes
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.deleted_at is null
    )
    or (
      visibility = 'team'
      and public.meeting_note_team_readable(user_id)
    )
  );

-- 5. 워크스페이스 판정 함수는 이제 아무도 부르지 않는다
drop function if exists public.meeting_note_shared_to_crm(uuid);

commit;
