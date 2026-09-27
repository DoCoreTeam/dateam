-- 292_trading_consensus.sql — 신호가 무엇과 무엇의 합의였나 (명세 §7.2 · §13.5)
--
-- 왜: 신호 행은 판단 하나(`judgment_id`)만 가리켰다. 그 하나는 늘 `rule` 이었고,
-- Jev 는 기록만 되고 신호에 닿는 길이 없었다. 「Jev 가 나은가」를 나중에 재려면
-- **그 신호가 무엇과 무엇의 합의였는지**가 그 행에 남아 있어야 한다.
--
-- 판단 하나를 골라 `judgment_id` 에 넣는 방식은 안 쓴다 — 고른 그 순간에 정보가 하나 사라지고,
-- 사라진 뒤에는 되돌릴 수 없다.
--
-- 이 판은 기존 표에 **칼럼만 더한다.** 표도 정책도 RLS 도 안 건드린다.

ALTER TABLE public.trading_signals
  -- 같은 봉의 Jev 판단. 없으면 Jev 없이 난 신호다
  ADD COLUMN IF NOT EXISTS jev_judgment_id UUID REFERENCES public.trading_judgments(id) ON DELETE SET NULL,
  -- 합의 판정을 한 줄로. 'agreed:long' · 'single:rule' 처럼 적는다
  ADD COLUMN IF NOT EXISTS consensus TEXT;

CREATE INDEX IF NOT EXISTS idx_trading_signals_jev_judgment
  ON public.trading_signals (jev_judgment_id);

COMMENT ON COLUMN public.trading_signals.jev_judgment_id IS
  '같은 봉의 Jev 판단. 「Jev 가 나은가」(§13.5)를 나중에 재려면 이 자리가 있어야 한다';
COMMENT ON COLUMN public.trading_signals.consensus IS
  '무엇과 무엇의 합의였나. 판단 하나를 골라 덮으면 그 순간 정보가 사라진다';
