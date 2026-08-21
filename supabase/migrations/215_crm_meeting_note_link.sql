-- 215_crm_meeting_note_link.sql
-- 회의노트 ↔ CRM 미팅 연결 (추가 전용 — 기존 행 변형 0)
--
-- 왜: 같은 회의를 두 곳이 각자 기록하고 있었다.
--   /meeting-notes (3,968줄, 문서 세트 5벌) 가 본문·요약·참석자·전사 자리를 이미 갖고 있고,
--   /crm/meetings 는 회사·딜·5축 제안을 갖는다. 원본을 두 벌로 두면 어느 쪽이 진실인지 알 수 없다.
--   → 원본은 회의노트 하나, CRM 은 "발행"받아 그 시점의 스냅샷을 보유한다.
--
-- ⚠️ FK 를 걸지 않는다 (관계 계약: 참조refs).
--   ① meeting_notes 는 소프트 삭제라 FK 가 발화하지 않는다.
--   ② ON DELETE SET NULL 로 두면 "어느 노트였는지"조차 잃어 복구가 불가능해진다.
--   그래서 노트가 지워져도 noteId 는 남기고, 화면이 "원본 없음"이라고 말한다.
--   CRM 은 스냅샷을 갖고 있으므로 원본이 사라져도 팀의 영업 기록은 산다.
--
-- 컬럼명이 camelCase 인 이유: crm_* 테이블은 Prisma 가 만든 것이라 컬럼이 따옴표 camelCase 다(198 참조).

ALTER TABLE "crm_meeting"
  ADD COLUMN IF NOT EXISTS "noteId" TEXT,
  ADD COLUMN IF NOT EXISTS "noteSyncedAt" TIMESTAMP(3);

COMMENT ON COLUMN "crm_meeting"."noteId" IS
  '원본 meeting_notes.id (FK 없음 — 관계 계약 refs). 노트가 지워져도 남긴다.';
COMMENT ON COLUMN "crm_meeting"."noteSyncedAt" IS
  '스냅샷을 뜬 시각. 노트의 updated_at 이 이보다 크면 화면이 "원본이 그 뒤 수정됨"을 알린다.';

-- 발행 여부 조회 + 멱등 확인용. 활성 행만.
CREATE INDEX IF NOT EXISTS "crm_meeting_noteId_idx"
  ON "crm_meeting"("noteId") WHERE "deletedAt" IS NULL;
