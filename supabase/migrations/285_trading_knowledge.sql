-- 285 Release 2 지식과 설명 — Gemini 산출물 여섯 표
--
-- ## 왜 표마다 `available_at` 인가
--
-- 백테스트는 「그 시점에 알 수 있었던 것」만 봐야 한다. 오늘 쓴 지식 카드가 석 달 전 봉의
-- 판단에 섞이면, 그 백테스트는 미래를 보고 친 것이고 성적은 실전에서 재현되지 않는다.
-- 그래서 모든 산출물이 **쓴 시각**을 달고, 읽는 쪽은 `available_at <= asOf` 로만 읽는다.
-- NULL 을 허용하면 그 줄이 「언제든 쓸 수 있는 것」이 되므로 NOT NULL 이다.
--
-- ## 되돌리기
--   DROP TABLE IF EXISTS public.trading_exit_judgments;
--   DROP TABLE IF EXISTS public.trading_signal_explanations;
--   DROP TABLE IF EXISTS public.trading_spec_candidates;
--   DROP TABLE IF EXISTS public.trading_pattern_reports;
--   DROP TABLE IF EXISTS public.trading_source_analyses;
--   DROP TABLE IF EXISTS public.trading_knowledge_cards;

-- ── 지식 카드 ──────────────────────────────────────────────
-- 한 주제에 대해 지금까지 확인된 것. 근거가 0건이면 만들지 않는다.
CREATE TABLE IF NOT EXISTS public.trading_knowledge_cards (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         TEXT        NOT NULL,
  -- 같은 주제를 고치면 새 판으로 쌓는다. 덮어쓰면 「그때 무엇을 알고 있었나」가 사라진다
  revision      INTEGER     NOT NULL DEFAULT 1,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  -- 근거. 빈 배열이면 이 행이 서지 않는다(아래 검사 제약)
  sources       JSONB       NOT NULL,
  model         TEXT        NOT NULL,
  prompt_version TEXT       NOT NULL,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic, revision),
  CONSTRAINT trading_knowledge_cards_sources_not_empty
    CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0)
);

CREATE INDEX IF NOT EXISTS idx_trading_knowledge_cards_asof
  ON public.trading_knowledge_cards (available_at DESC);

-- ── 소스 분석 ──────────────────────────────────────────────
-- 사람이 넣은 자료를 읽고 정리한 것. 원문은 보존한다 — 다시 분석할 수 있어야 한다.
CREATE TABLE IF NOT EXISTS public.trading_source_analyses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 같은 내용을 두 번 분석하지 않는다
  content_hash  TEXT        NOT NULL UNIQUE,
  source_kind   TEXT        NOT NULL CHECK (source_kind IN ('text', 'url', 'upload')),
  source_ref    TEXT        NOT NULL,
  raw_text      TEXT        NOT NULL,
  summary       TEXT,
  findings      JSONB,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'done', 'failed')),
  -- 조용한 실패 금지
  reason        TEXT,
  user_message  TEXT,
  model         TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 패턴 리포트 ────────────────────────────────────────────
-- 쌓인 기록에서 뽑은 패턴. 셈은 코드가 하고 AI 는 말로 옮기기만 한다.
CREATE TABLE IF NOT EXISTS public.trading_pattern_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 무엇을 보고 만들었나. 없으면 「세 건으로 낸 리포트」와 구별되지 않는다
  window_from   DATE        NOT NULL,
  window_to     DATE        NOT NULL,
  sample_count  INTEGER     NOT NULL CHECK (sample_count >= 0),
  -- 코드가 센 숫자. AI 가 만든 값이 아니다
  metrics       JSONB       NOT NULL,
  narrative     TEXT,
  model         TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (window_from, window_to)
);

-- ── 스펙 후보 ──────────────────────────────────────────────
-- AI 가 제안만 한다. 적용은 사람이 하고 다음 거래일부터다(§15.2 · §15.3).
CREATE TABLE IF NOT EXISTS public.trading_spec_candidates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key   TEXT        NOT NULL,
  current_value JSONB,
  proposed_value JSONB      NOT NULL,
  rationale     TEXT        NOT NULL,
  -- 무엇을 보고 제안했나
  evidence      JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'accepted', 'rejected', 'expired')),
  -- 사람이 받아들였으면 누가 언제. AI 는 여기를 못 채운다
  decided_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  -- 받아들이면 이 날부터 유효하다. 오늘이 아니다(§15.2)
  effective_trade_date DATE,
  model         TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 키에 대기 중인 후보가 둘일 수 없다. 둘이면 사람이 무엇을 받아들인 것인지 모른다
  CONSTRAINT trading_spec_candidates_decided_together
    CHECK ((decided_by IS NULL) = (decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trading_spec_candidates_open
  ON public.trading_spec_candidates (setting_key) WHERE status = 'proposed';

-- ── 신호 설명 ──────────────────────────────────────────────
-- 알림이 나간 **뒤에** 붙는다. 알림은 이것을 기다리지 않는다(§12).
CREATE TABLE IF NOT EXISTS public.trading_signal_explanations (
  signal_id     UUID        PRIMARY KEY REFERENCES public.trading_signals(id) ON DELETE CASCADE,
  body          TEXT        NOT NULL,
  model         TEXT        NOT NULL,
  prompt_version TEXT       NOT NULL,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 청산 판단 (섀도) ───────────────────────────────────────
-- 보유 중에 계속 묻되 **알림으로 안 나간다**. 표본이 쌓이고 보정이 서야 쓴다(§7.3 D-11).
CREATE TABLE IF NOT EXISTS public.trading_exit_judgments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 어느 포지션의 어느 분인가. 1계약이라 종목코드가 포지션 키다
  contract_code TEXT        NOT NULL,
  bar_close_at  TIMESTAMPTZ NOT NULL,
  judge         TEXT        NOT NULL CHECK (judge IN ('rule', 'ml', 'jev')),
  spec_version  TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed', 'abstain', 'failed')),
  raw_score     JSONB,
  abstain_reason TEXT,
  jev_model_version  TEXT,
  jev_prompt_version TEXT,
  -- 섀도임을 표에 박는다. 참이 아닌 행이 들어오면 이 표를 잘못 쓰고 있는 것이다
  is_shadow     BOOLEAN     NOT NULL DEFAULT TRUE CHECK (is_shadow),
  decision_at   TIMESTAMPTZ,
  ai_request_at TIMESTAMPTZ,
  ai_response_at TIMESTAMPTZ,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 분에 같은 판단기를 두 번 안 부른다(§14.3)
  UNIQUE (contract_code, bar_close_at, judge, spec_version)
);

CREATE INDEX IF NOT EXISTS idx_trading_exit_judgments_recent
  ON public.trading_exit_judgments (contract_code, bar_close_at DESC);

-- ── 잠금 — 여섯 표 전부 같은 판에서 (S1) ───────────────────
--
-- 반복문으로 줄이지 않는다. `lib/policy/rls-baseline.test.ts` 가 마이그레이션 **글**을 읽어
-- 표마다 ENABLE 줄이 있는지 세는데, `EXECUTE format(...)` 안에 넣으면 가드가 못 본다.
-- 그리고 가드가 못 보는 잠금은 다음 표를 만들 때 빠뜨려도 아무도 모른다.

ALTER TABLE public.trading_knowledge_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_knowledge_cards FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_knowledge_cards FROM PUBLIC;
REVOKE ALL ON public.trading_knowledge_cards FROM anon;
REVOKE ALL ON public.trading_knowledge_cards FROM authenticated;
GRANT  ALL ON public.trading_knowledge_cards TO service_role;

ALTER TABLE public.trading_source_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_source_analyses FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_source_analyses FROM PUBLIC;
REVOKE ALL ON public.trading_source_analyses FROM anon;
REVOKE ALL ON public.trading_source_analyses FROM authenticated;
GRANT  ALL ON public.trading_source_analyses TO service_role;

ALTER TABLE public.trading_pattern_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_pattern_reports FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_pattern_reports FROM PUBLIC;
REVOKE ALL ON public.trading_pattern_reports FROM anon;
REVOKE ALL ON public.trading_pattern_reports FROM authenticated;
GRANT  ALL ON public.trading_pattern_reports TO service_role;

ALTER TABLE public.trading_spec_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_spec_candidates FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_spec_candidates FROM PUBLIC;
REVOKE ALL ON public.trading_spec_candidates FROM anon;
REVOKE ALL ON public.trading_spec_candidates FROM authenticated;
GRANT  ALL ON public.trading_spec_candidates TO service_role;

ALTER TABLE public.trading_signal_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_signal_explanations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_signal_explanations FROM PUBLIC;
REVOKE ALL ON public.trading_signal_explanations FROM anon;
REVOKE ALL ON public.trading_signal_explanations FROM authenticated;
GRANT  ALL ON public.trading_signal_explanations TO service_role;

ALTER TABLE public.trading_exit_judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_exit_judgments FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_exit_judgments FROM PUBLIC;
REVOKE ALL ON public.trading_exit_judgments FROM anon;
REVOKE ALL ON public.trading_exit_judgments FROM authenticated;
GRANT  ALL ON public.trading_exit_judgments TO service_role;

-- 켜졌는지 DB 에게 다시 묻는다. 위를 한 줄 빠뜨리면 그 표만 열려 있다
DO $$
DECLARE t TEXT; n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trading_knowledge_cards', 'trading_source_analyses', 'trading_pattern_reports',
    'trading_spec_candidates', 'trading_signal_explanations', 'trading_exit_judgments'
  ] LOOP
    SELECT count(*) INTO n FROM pg_class
     WHERE oid = format('public.%I', t)::regclass AND relrowsecurity AND relforcerowsecurity;
    IF n <> 1 THEN RAISE EXCEPTION '% 의 RLS 가 안 켜졌다', t; END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.trading_knowledge_cards IS
  '지식 카드. available_at 이 쓴 시각이고, 백테스트는 그 시각 이전 것만 읽는다';
COMMENT ON TABLE public.trading_exit_judgments IS
  '청산 판단 섀도(§7.3 D-11). 기록만 남고 알림으로 안 나간다 — is_shadow 가 참이 아니면 행이 안 선다';
COMMENT ON TABLE public.trading_spec_candidates IS
  'AI 가 낸 설정 변경 후보. 적용은 사람이 하고 다음 거래일부터다(§15.2 · §15.3)';
