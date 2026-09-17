-- 256_crm_task_source_meeting.sql
--
-- 회의에서 뽑은 할 일이 **어느 회의에서 나왔는지** 적을 자리.
--
-- 왜: 회의노트의 [할 일·일정 뽑기]로 만든 할 일 40건이 전부 `daily_logs`(개인 일일업무)
-- 로만 갔고 `crm_task` 에는 0건이었다(2026-09-17 실측). 딜 상세의 할 일 패널은
-- `crm_task` 를 딜로 걸러 보므로 그 40건은 **딜 화면에 영원히 안 뜬다**
-- (사용자 지적: "할일들 뽑으면 딜에서도 관련 프로젝트와 관련된 할일이 보여야 하는데 안보이는것 같은데?").
--
-- 관계 종류는 **참조(refs)** 다(§R-1). 할 일은 회의 없이도 존재 이유가 있다 —
-- 미팅을 지워도 할 일은 남고 출처만 비워진다. 그래서 CASCADE 가 아니다.
-- FK 를 안 거는 것은 이 표의 다른 참조(companyId·personId·dealId)와 같은 방식이다.
--
-- 이 칸의 두 번째 쓸모는 **멱등**이다. 같은 회의에서 같은 제목을 두 번 뽑아도
-- 할 일은 하나여야 한다 — 회의 중에 [뽑기]를 두 번 누르는 것은 흔한 일이다.

ALTER TABLE crm_task ADD COLUMN IF NOT EXISTS "sourceMeetingId" TEXT;

-- 멱등 검사(같은 미팅 + 같은 제목)와 「이 회의에서 나온 할 일」 조회가 둘 다 이 인덱스를 쓴다
CREATE INDEX IF NOT EXISTS crm_task_source_meeting_idx
  ON crm_task ("workspaceId", "sourceMeetingId");

COMMENT ON COLUMN crm_task."sourceMeetingId" IS
  '이 할 일이 나온 CRM 미팅(crm_meeting.id). 참조(refs) — 미팅이 지워져도 할 일은 남는다. FK 없음';
