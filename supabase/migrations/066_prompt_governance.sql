-- 축6: AI 프롬프트 자가갱신 자동반영 + 감사 + 롤백 인프라.
-- D3: AI 자가갱신은 자동 active 전환(사람 승격 아님), 사람은 롤백. 모든 변경 append-only 스냅샷.

-- 1) 변경 이력 스냅샷(append-only) — 롤백·diff 근거
CREATE TABLE IF NOT EXISTS public.ai_prompt_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL,
  version text NOT NULL,
  content text NOT NULL,
  source text NOT NULL CHECK (source IN ('ai','human')),
  event text NOT NULL CHECK (event IN ('auto_activated','auto_rolled_back','rolled_back','edited','held','activated','deactivated')),
  reason text,                       -- 왜: 트리거 근거(자연어)
  trigger text,                      -- 왜: empty_extraction|low_confidence|gate_blocked|manual|live_degraded
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_revisions_key ON public.ai_prompt_revisions(prompt_key, created_at DESC);
ALTER TABLE public.ai_prompt_revisions ENABLE ROW LEVEL SECURITY;
-- service_role(서버)만 쓰기, 관리자 읽기는 API(service_role) 경유
DROP POLICY IF EXISTS prompt_rev_service ON public.ai_prompt_revisions;
CREATE POLICY prompt_rev_service ON public.ai_prompt_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) ai_prompts 메타 보강
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS source text DEFAULT 'human' CHECK (source IN ('ai','human'));

-- 3) 같은 prompt_key active 1건 강제(데이터 정합)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_prompts_active_per_key ON public.ai_prompts(prompt_key) WHERE active = true;
