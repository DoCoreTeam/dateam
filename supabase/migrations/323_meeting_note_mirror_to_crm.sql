-- 323_meeting_note_mirror_to_crm.sql
-- CRM 미팅의 제목, 일시, 요약을 회의노트가 바뀔 때마다 DB 가 따라 적는다.
--
-- 사용자 결정(2026-10-27): 회의 기록은 회의노트 하나, CRM 미팅은 그 노트를 보여 주는 자리.
--
-- **왜 칸을 지우지 않고 DB 가 따라 적나.**
--   crm_meeting.summaryMd 를 읽는 곳이 일곱이다(딜 단계 점검, 다음 행동, 추출 맥락, 내보내기,
--   오늘 미팅, 옆 패널, 미팅 패널). 그 가운데 예약 작업은 읽는 사람의 세션이 없어 노트를 RLS 로 못 읽는다.
--   그래서 칸은 남기고, 쓰는 길을 「반영하기」 단추에서 이 트리거 하나로 바꾼다.
--   이제 노트를 고치면 CRM 이 바로 같은 값을 가진다. 어긋날 길이 없다.
--
-- **요약은 팀 공개 노트만 따라 적는다.**
--   나만 보기 노트의 요약이 이 칸에 남으면 딜 AI 와 내보내기를 거쳐 워크스페이스 전원에게 보인다.
--   그것이 옛 「기록만」이 사본을 팀에 보여 주던 길이다. 나만 보기면 null 로 둔다.
--   본인은 CRM 화면에서 노트를 직접 읽으므로(RLS) 요약을 잃지 않는다.
--
-- **제목과 일시는 늘 따라 적는다.** 목록의 정렬과 검색이 이 두 칸으로 돈다.
--   남에게 보이는지는 CRM 목록이 노트의 RLS 로 거른다(앱 lib/crm/services/meeting-note-read.ts).
--
-- 실측 2026-10-29: 제목이나 일시가 노트와 다른 미팅 1건(휴지통의 시험 미팅), 요약이 있는데 노트 요약이 빈 미팅 0건.
--   그래서 아래 한 번 맞추기가 사람이 쓴 값을 잃게 하지 않는다.
--
-- 되돌리기:
--   drop trigger if exists trg_meeting_notes_mirror_to_crm on public.meeting_notes;
--   drop function if exists public.meeting_notes_mirror_to_crm();
--   drop function if exists private.meeting_note_summary_md(text, text);
--   (한 번 맞춘 summaryMd 는 노트에서 다시 계산되는 값이라 되돌릴 원본이 노트에 그대로 있다)

begin;

-- 1. 요약 조립: 앱 composeSummary(lib/crm/services/meeting-publish.ts) 와 같은 모양
create or replace function private.meeting_note_summary_md(p_summary text, p_decisions text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(btrim(p_summary), '') = '' and coalesce(btrim(p_decisions), '') = '' then null
    when coalesce(btrim(p_decisions), '') = '' then btrim(p_summary)
    when coalesce(btrim(p_summary), '') = '' then E'## 결정사항\n\n' || btrim(p_decisions)
    else btrim(p_summary) || E'\n\n## 결정사항\n\n' || btrim(p_decisions)
  end;
$$;

revoke all on function private.meeting_note_summary_md(text, text) from public;
revoke all on function private.meeting_note_summary_md(text, text) from anon;

-- 2. 트리거: 노트의 다섯 칸이 바뀌면 그 노트를 가리키는 CRM 미팅을 같은 값으로
--    노트는 authenticated 가 RLS 로 고치고 crm_meeting 은 그 역할에 열려 있지 않다, 그래서 SECURITY DEFINER
create or replace function public.meeting_notes_mirror_to_crm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.crm_meeting m
  set title = coalesce(nullif(btrim(new.title), ''), m.title),
      "startedAt" = coalesce(new.meeting_at, m."startedAt"),
      "summaryMd" = case
        when new.visibility = 'team' then private.meeting_note_summary_md(new.summary, new.decisions)
        else null
      end,
      "noteSyncedAt" = now(),
      "updatedAt" = now()
  where m."noteId" = new.id::text;
  return null;
end;
$$;

revoke all on function public.meeting_notes_mirror_to_crm() from public;
revoke all on function public.meeting_notes_mirror_to_crm() from anon;

drop trigger if exists trg_meeting_notes_mirror_to_crm on public.meeting_notes;
create trigger trg_meeting_notes_mirror_to_crm
  after update of title, meeting_at, summary, decisions, visibility on public.meeting_notes
  for each row execute function public.meeting_notes_mirror_to_crm();

-- 3. 지금 있는 미팅을 한 번 맞춘다
update public.crm_meeting m
set title = coalesce(nullif(btrim(n.title), ''), m.title),
    "startedAt" = coalesce(n.meeting_at, m."startedAt"),
    "summaryMd" = case
      when n.visibility = 'team' then private.meeting_note_summary_md(n.summary, n.decisions)
      else null
    end,
    "noteSyncedAt" = now(),
    "updatedAt" = now()
from public.meeting_notes n
where m."noteId" = n.id::text;

commit;
