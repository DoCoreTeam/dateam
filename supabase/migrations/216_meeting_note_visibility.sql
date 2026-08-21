-- 216_meeting_note_visibility.sql
-- 회의노트 공개 범위 (추가 전용 — 기존 행은 전부 기본값 'private' 로 지금 동작 그대로)
--
-- 사용자 결정(D6): "설정으로 하면 되는데 미팅에서 생성하면 기본으로 공개이고
--                   수정 할 수 있음 되지 나만보기 라던지"
--
-- 그래서 기본값이 **출처에 따라 다르다**:
--   · 회의노트에서 만들면 → 'private' (컬럼 기본값. 지금 RLS 동작과 같다)
--   · CRM 미팅에서 만들면 → 'crm'     (코드가 명시로 넣는다)
--
-- ⚠️ 읽기 공개이지 편집 공개가 아니다. UPDATE·DELETE 정책은 **건드리지 않는다** —
--    남이 내 회의노트를 고치게 되면 그건 공개가 아니라 양도다.
--
-- 117 이 예고해 둔 자리다:
--   "확장지점: … 조건을 OR로 추가."

alter table meeting_notes
  add column if not exists visibility text not null default 'private';

-- 값은 등록된 것만. 오타가 조용히 새 값을 만들면 RLS 가 아무도 모르게 닫힌다.
-- 나중에 'dept'(부서 공개)를 더할 때는 이 제약에 값 하나만 추가하면 된다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meeting_notes_visibility_chk'
  ) then
    alter table meeting_notes
      add constraint meeting_notes_visibility_chk
      check (visibility in ('private', 'crm'));
  end if;
end $$;

comment on column meeting_notes.visibility is
  'private=본인+admin(기본) / crm=연결된 CRM 워크스페이스 멤버도 읽음. 읽기 전용 공개 — 수정·삭제는 언제나 본인만.';

-- SELECT 정책 확장: 기존 두 조건(본인 / admin)은 **그대로 두고** OR 한 갈래만 덧붙인다.
-- 조건: 이 노트를 원본으로 삼은 CRM 미팅이 있고, 그 워크스페이스의 살아있는 멤버여야 한다.
--   · crm_meeting."noteId" 는 215 에서 추가한 연결 컬럼(FK 없음 — 관계 계약 refs)
--   · crm_member."hostUserId" 는 profiles.id 문자열
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
      and exists (
        select 1
        from "crm_meeting" m
        join "crm_member" cm on cm."workspaceId" = m."workspaceId"
        where m."noteId" = meeting_notes.id::text
          and m."deletedAt" is null
          and cm."hostUserId" = auth.uid()::text
          and cm."deletedAt" is null
      )
    )
  );

-- 조인 성능: crm_member 를 hostUserId 로 찾는 경로가 RLS 안에서 매 행 돈다.
create index if not exists "crm_member_hostUserId_idx" on "crm_member"("hostUserId");
