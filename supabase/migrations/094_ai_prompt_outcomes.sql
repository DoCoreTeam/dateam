-- 094_ai_prompt_outcomes.sql
-- D-2: AI 프롬프트 "품질 신호" 적재 — 자가학습 거버넌스가 품질저하를 감지할 입력 신호.
--   기존엔 GPU의 items.length===0(추출실패)만 신호였으나, 일일은 항상 무언가 반환 → 과분할·저신뢰를
--   결정적으로 측정(lib/daily-quality.ts evalDailyExtraction)해 사용 직후 적재한다.
--   거버넌스는 최근 degraded 비율로 자가합성/롤백을 판단한다.
-- 멱등: create table if not exists. RLS: 적재는 service_role(서버), 읽기는 admin 운영.

CREATE TABLE IF NOT EXISTS ai_prompt_outcomes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key  text NOT NULL,
  version     text NOT NULL,
  ok          boolean NOT NULL,            -- 결정적 품질 게이트 통과 여부
  metric      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {charsPerItem, avgConfidence, itemCount, reasons}
  user_id     uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 최근 degraded 비율 집계용
CREATE INDEX IF NOT EXISTS idx_apo_key_created ON ai_prompt_outcomes (prompt_key, created_at DESC);

COMMENT ON TABLE ai_prompt_outcomes IS 'AI 프롬프트 사용 직후 결정적 품질 신호(자가학습 트리거 입력). ok=false 누적 시 자가합성/롤백.';

ALTER TABLE ai_prompt_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS apo_service_write ON ai_prompt_outcomes;
CREATE POLICY apo_service_write ON ai_prompt_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS apo_member_read ON ai_prompt_outcomes;
CREATE POLICY apo_member_read ON ai_prompt_outcomes FOR SELECT TO authenticated USING (public.is_member());

-- 롤백: DROP TABLE IF EXISTS ai_prompt_outcomes;
