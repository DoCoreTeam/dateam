-- 322_crm_meeting_backfill_note.sql
-- 원본 회의노트가 없는 CRM 미팅에 노트를 만들어 붙인다.
--
-- 사용자 결정(2026-10-27): 회의 기록은 회의노트 하나, CRM 미팅은 그 노트에 회사 딜을 붙인 것.
-- 그러려면 모든 미팅이 노트를 가리켜야 한다. 실측 2026-10-27, noteId 가 빈 미팅 13건
-- (휴지통 12건은 2026-08-16~24 의 시험 미팅, 살아 있는 것 1건).
--
-- 만드는 노트
--   · 주인: 미팅을 만든 CRM 멤버의 사용자(crm_member.hostUserId). 남의 이름으로 만들지 않는다
--   · 공개: team. 예전에 워크스페이스 전원이 보던 미팅이라 「팀 공개」로 옮긴다(사용자 결정)
--   · 휴지통: 미팅이 휴지통이면 노트도 같은 시각으로 휴지통
--   · 내용: 제목, 일시, 요약(summaryMd), 전사(구간을 시간순으로 「화자: 글」 줄로 이음)
--
-- 되돌리기 (대상 미팅 id 는 아래 표에 고정돼 있다):
--   delete from meeting_notes where id::text in (select "noteId" from crm_meeting where id in (<아래 13개>));
--   update crm_meeting set "noteId" = null, "noteSyncedAt" = null where id in (<아래 13개>);

begin;

create temp table backfill_target (meeting_id text primary key) on commit drop;
insert into backfill_target (meeting_id) values
  ('cmsvut6vp000jz9na79pd8dhi'), ('cmsvuspyt0029z91cc53xk8qf'), ('cmsvw53bv000vz9nadgwap7ya'),
  ('cmsvxg7q30028z9nawxqehwro'), ('cmsvybwcj003ez9na2tdf7rbd'), ('cmsvv8uq1002zz91c29ayvlqx'),
  ('cmsvvb8ka003hz91cgptimy77'), ('cmsvvbr5o003wz91c6jpudi2c'), ('cmsvvzkfe004vz91cpksav22b'),
  ('cmsvxsxvd0064z91ctds6x3wk'), ('cmsvy9vhl0067z91ctdqikc0a'), ('cmt2w63hd0001le04bjbama5h'),
  ('cmt6n36dh003vz910vipdc8ot');

create temp table backfill_map on commit drop as
select m.id as meeting_id, gen_random_uuid() as note_id
from public.crm_meeting m
join backfill_target t on t.meeting_id = m.id
where m."noteId" is null;

insert into public.meeting_notes
  (id, user_id, title, meeting_at, summary, transcript, visibility, status, deleted_at, created_at, updated_at)
select
  bm.note_id,
  cm."hostUserId"::uuid,
  m.title,
  m."startedAt",
  nullif(m."summaryMd", ''),
  (
    select string_agg(coalesce(nullif(s.speaker, ''), '화자') || ': ' || s.text, E'\n' order by r."createdAt", s.idx)
    from public.crm_meeting_recording r
    join public.crm_transcript_segment s on s."recordingId" = r.id
    where r."meetingId" = m.id
  ),
  'team',
  'final',
  m."deletedAt",
  m."createdAt",
  now()
from backfill_map bm
join public.crm_meeting m on m.id = bm.meeting_id
join public.crm_member cm on cm.id = m."createdById";

-- 주인을 못 찾은 미팅이 있으면 여기서 멈춘다 (조용히 일부만 옮기지 않는다)
do $$
declare made int; wanted int;
begin
  select count(*) into wanted from backfill_map;
  select count(*) into made from public.meeting_notes n join backfill_map bm on bm.note_id = n.id;
  if made <> wanted then
    raise exception '노트를 만든 수(%)가 대상 수(%)와 다릅니다, 주인을 못 찾은 미팅이 있습니다', made, wanted;
  end if;
end $$;

update public.crm_meeting m
set "noteId" = bm.note_id::text,
    "noteSyncedAt" = now()
from backfill_map bm
where m.id = bm.meeting_id;

commit;
