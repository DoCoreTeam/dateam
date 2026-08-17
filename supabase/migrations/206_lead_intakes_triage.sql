-- 206: 리드 큐를 사람이 끝낼 수 있는 큐로 만든다 (건너뛰기 + 정렬)
--
-- **왜**: 205 로 사본 1,134건을 지워 380건이 됐지만, 큐는 여전히 **끝낼 수 없다.**
--   지금 큐에서 리드가 빠지는 길은 "CRM 으로 옮기기" 하나뿐이다.
--   그래서 옮길 값어치가 없는 리드(회사 이름이 없는 것·죽은 것)는 영원히 남고,
--   화면은 "N건 남음"을 계속 띄운다. 사용자가 "일괄처리 할 수 있는 UI가 필요하다"고 한 이유다.
--
-- **건너뛰기는 삭제가 아니다.** 리드 원문은 그대로 두고 자국만 남긴다 —
--   되돌리면 큐로 돌아온다. 되돌릴 수 없는 삭제는 여기서 하지 않는다.
--
-- **정렬 근거**: 라우트 주석은 "적합도가 높은 것부터"라고 적혀 있었는데
--   코드는 created_at 으로 정렬하고 있었다(v0.7.539 실측). 즉 **주석이 거짓말**이었다.
--   fit_score 는 381/383 행에 채워져 있으므로 그 값으로 정렬할 수 있게 인덱스를 만든다.

BEGIN;

-- ── 1. 건너뛰기 자국 ────────────────────────────────────────────────────
ALTER TABLE lead_intakes
  ADD COLUMN IF NOT EXISTS crm_skipped_at  timestamptz,
  ADD COLUMN IF NOT EXISTS crm_skip_reason text;

COMMENT ON COLUMN lead_intakes.crm_skipped_at IS
  '큐에서 내린 시각. NULL 이면 아직 큐에 있다. 되돌리면 다시 NULL 이 된다(삭제 아님).';
COMMENT ON COLUMN lead_intakes.crm_skip_reason IS
  '왜 내렸는지 — 나중에 "이건 왜 안 옮겼지"에 답하려면 이유가 있어야 한다.';

-- ── 2. 큐 조회 인덱스 ───────────────────────────────────────────────────
-- 큐 = 아직 안 옮겼고 안 내린 것. 이 조건이 목록의 유일한 정의다.
CREATE INDEX IF NOT EXISTS idx_lead_intakes_queue
  ON lead_intakes (fit_score DESC NULLS LAST, created_at DESC)
  WHERE crm_migrated_at IS NULL AND crm_skipped_at IS NULL;

-- 회사명 검색(큐가 380건이면 눈으로 찾는 게 아니라 검색해서 찾는다)
CREATE INDEX IF NOT EXISTS idx_lead_intakes_company_name
  ON lead_intakes ((parsed_data->>'company_name'))
  WHERE crm_migrated_at IS NULL AND crm_skipped_at IS NULL;

-- ── 3. fit_score 보정 ───────────────────────────────────────────────────
-- 컬럼이 비어 있고 parsed_data 에만 있는 행이 있으면 컬럼으로 올린다.
-- (정렬을 JSON 표현식이 아니라 컬럼으로 하면 인덱스가 그대로 쓰인다)
UPDATE lead_intakes
   SET fit_score = (parsed_data->>'fit_score')::int
 WHERE fit_score IS NULL
   AND parsed_data->>'fit_score' ~ '^[0-9]+$';

COMMIT;
