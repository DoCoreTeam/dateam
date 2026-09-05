-- 241: 회의노트 참석자를 CRM 인물과 잇는다
--
-- 왜: 회의노트의 참석자 칸(`attendees text[]`)은 글자 배열이라 CRM 인물과 이어지지 않는다.
--     그래서 회의에 이름이 적힌 외부인이 CRM 어디에도 안 나타나고(실측 9명),
--     CRM 에 있는 사람조차 자기 회의를 화면에서 볼 수 없다.
--     조직원은 이미 `attendee_user_ids uuid[]` 로 잇고 있는데, 외부인만 그 자리가 없었다.
--
-- 추가 전용(M-4): 기존 `attendees` 는 그대로 둔다. 원문 표기(「컬쳐랜드 김시홍팀장」)는
--     되짚을 수 있어야 하고, 이 칼럼이 비어 있어도 예전과 똑같이 동작해야 한다.
--
-- 타입이 uuid 가 아니라 text 인 이유: `crm_person.id` 가 text(cuid)다.
--     FK 는 걸 수 없다 — 회의노트는 호스트(Supabase) 쪽이고 CRM 은 워크스페이스로 갈린 별도 계통이라
--     DB 수준에서 참조가 성립하지 않는다. 그래서 코드가 챙긴다(관계 계약 R-3 의 「작업」에 해당).

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS attendee_person_ids text[];

COMMENT ON COLUMN meeting_notes.attendee_person_ids IS
  'CRM 인물(crm_person.id)과 이어진 외부 참석자. attendees 의 원문 표기는 그대로 남는다. FK 없음 — 코드가 정리한다';

-- 인물 상세에서 「이 사람과 한 회의」를 물을 때 쓰는 길
CREATE INDEX IF NOT EXISTS idx_meeting_notes_attendee_person_ids
  ON meeting_notes USING gin (attendee_person_ids)
  WHERE deleted_at IS NULL;
