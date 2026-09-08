-- 할 일에 «시작일»을 준다 (사용자 지시 2026-09-08: 「할일도 시작과 종료일이 있어야 할 것 같아」)
--
-- 지금까지 할 일에는 마감(dueAt) 하나뿐이었다. 그래서 「언제부터 하는 일인지」를 적을 자리가 없고,
-- 며칠 걸리는 일도 마감 하루로만 보였다. 종료일은 이미 dueAt 이 그 뜻이므로 **시작일만** 더한다.
--
-- expand 전용이다 — nullable 칼럼 하나를 더할 뿐이라 기존 행·기존 코드에 영향이 없고,
-- 되돌리려면 이 칼럼만 지우면 된다(M-4 추가 전용 · M-12 되돌릴 수 있는 형태).

ALTER TABLE crm_task ADD COLUMN IF NOT EXISTS "startAt" timestamptz;

COMMENT ON COLUMN crm_task."startAt" IS
  '할 일을 시작하는 날(KST 벽시계의 그날 00:00 을 UTC 로 적재). NULL 이면 시작일을 안 정한 것.';

-- 기간으로 훑는 화면(달력·주간)이 쓸 인덱스. 마감만 있던 인덱스는 그대로 둔다.
CREATE INDEX IF NOT EXISTS crm_task_workspace_start_idx
  ON crm_task ("workspaceId", "startAt");
