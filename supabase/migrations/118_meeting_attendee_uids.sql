-- 118_meeting_attendee_uids.sql
-- 회의노트 참석자 ↔ 조직원 릴레이션 (가산적 — ADD only, 기존 데이터 변형 0).
-- 기획: docs/2026-06-20-v0.7.205-meeting-relations/01-architecture.md §데이터모델.
-- 외부인 = attendees(text[])만(uuid 없음). 내부인 = attendees(이름) + attendee_user_ids(uuid) 동시.
-- daily_logs.meeting_note_id, calendar_events.link_kind='meeting'은 117에서 이미 추가됨 — 재추가 금지.

-- attendee_user_ids: 매칭된 내부 조직원 uuid 배열. default null (기존 행 변형 없음).
alter table meeting_notes
  add column if not exists attendee_user_ids uuid[];

-- GIN 인덱스: 향후 "내가 참석한 회의" 필터(attendee_user_ids @> array[uid]) 대비. 활성행만(partial WHERE deleted_at IS NULL).
create index if not exists idx_meeting_notes_attendee_uids
  on meeting_notes using gin (attendee_user_ids) where deleted_at is null;
