-- 286 Release 3 AI 운영자 — 점검·조치·브리핑·리포트
--
-- ## 왜 조치를 append-only 로 두나
--
-- 「AI 가 무엇을 했나」는 나중에 물어야 할 일이다. 조치 행을 덮어쓰면 그 물음에 답할 것이
-- 없어진다. 그리고 답할 것이 없으면 다음에는 AI 에게 더 안 맡기게 된다 — 맡길 수 있는
-- 범위를 넓히려면 **무엇을 했는지 다 남아 있어야** 한다.
--
-- ## 왜 점검에 유일 키를 거나
--
-- 크론이 매분 돈다. 같은 날 같은 점검이 390번 쌓이면 화면은 못 읽고, 「오늘 무엇이
-- 잘못됐나」를 세는 일이 불가능해진다.
--
-- ## 되돌리기
--   DROP TABLE IF EXISTS public.trading_operator_actions;
--   DROP TABLE IF EXISTS public.trading_briefings;
--   DROP TABLE IF EXISTS public.trading_reports;
--   DROP TABLE IF EXISTS public.trading_health_checks;

-- ── 점검 결과 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_health_checks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date    DATE        NOT NULL,
  check_id      TEXT        NOT NULL,
  -- ok · warn · fail · unknown. **모르는 것을 괜찮다고 안 센다**
  status        TEXT        NOT NULL CHECK (status IN ('ok', 'warn', 'fail', 'unknown')),
  -- 기계가 읽는 사유와 사람이 읽을 한 줄. 둘 다 있어야 조용히 안 지나간다
  reason        TEXT        NOT NULL,
  user_message  TEXT        NOT NULL,
  -- 무엇을 보고 그렇게 판정했나. 숫자다 — AI 가 「이상한 것 같다」로 판정하지 않는다
  measured      JSONB       NOT NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 날 같은 점검은 하나. 매분 도는 크론이 390줄을 안 쌓는다
  UNIQUE (trade_date, check_id)
);

CREATE INDEX IF NOT EXISTS idx_trading_health_checks_recent
  ON public.trading_health_checks (trade_date DESC, status);

-- ── 조치 기록 (append-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_operator_actions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date    DATE        NOT NULL,
  check_id      TEXT        NOT NULL,
  action_id     TEXT        NOT NULL,
  -- 누가 했나. AI 인지 사람인지가 칸으로 있어야 「AI 가 무엇을 했나」를 셀 수 있다
  actor_kind    TEXT        NOT NULL CHECK (actor_kind IN ('ai', 'human')),
  actor_user_id UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- 사람이면 누구인지가 있어야 한다. AI 면 없다
  CONSTRAINT trading_operator_actions_human_has_id
    CHECK ((actor_kind = 'human') = (actor_user_id IS NOT NULL)),
  outcome       TEXT        NOT NULL CHECK (outcome IN ('applied', 'handed_off', 'refused', 'failed')),
  reason        TEXT        NOT NULL,
  -- 사람에게 넘겼으면 어느 업무로 갔나. 새 할 일 표를 안 만들고 daily_logs 를 가리킨다
  handoff_log_id UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_operator_actions_recent
  ON public.trading_operator_actions (trade_date DESC, occurred_at DESC);

-- 같은 날 같은 점검을 같은 조치로 두 번 넘기지 않는다. 사람 할 일이 날마다 쌓이면 안 본다
CREATE UNIQUE INDEX IF NOT EXISTS uq_trading_operator_actions_handoff
  ON public.trading_operator_actions (trade_date, check_id, action_id)
  WHERE outcome = 'handed_off';

-- ── 브리핑 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_briefings (
  trade_date    DATE        PRIMARY KEY,
  -- 코드가 센 숫자. AI 가 만든 값이 아니다
  metrics       JSONB       NOT NULL,
  narrative     TEXT,
  model         TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 기간 리포트 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from   DATE        NOT NULL,
  period_to     DATE        NOT NULL,
  metrics       JSONB       NOT NULL,
  narrative     TEXT,
  model         TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 기간을 두 번 만들지 않는다
  UNIQUE (period_from, period_to),
  CONSTRAINT trading_reports_period_ordered CHECK (period_from <= period_to)
);

-- ── 잠금 — 네 표 전부 같은 판에서 (S1) ─────────────────────
--
-- 반복문으로 줄이지 않는다. `lib/policy/rls-baseline.test.ts` 가 마이그레이션 **글**을 읽어
-- 표마다 ENABLE 줄이 있는지 센다. 가드가 못 보는 잠금은 다음 표에서 빠뜨려도 아무도 모른다.

ALTER TABLE public.trading_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_health_checks FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_health_checks FROM PUBLIC;
REVOKE ALL ON public.trading_health_checks FROM anon;
REVOKE ALL ON public.trading_health_checks FROM authenticated;
GRANT  ALL ON public.trading_health_checks TO service_role;

ALTER TABLE public.trading_operator_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_operator_actions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_operator_actions FROM PUBLIC;
REVOKE ALL ON public.trading_operator_actions FROM anon;
REVOKE ALL ON public.trading_operator_actions FROM authenticated;
GRANT  ALL ON public.trading_operator_actions TO service_role;

ALTER TABLE public.trading_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_briefings FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_briefings FROM PUBLIC;
REVOKE ALL ON public.trading_briefings FROM anon;
REVOKE ALL ON public.trading_briefings FROM authenticated;
GRANT  ALL ON public.trading_briefings TO service_role;

ALTER TABLE public.trading_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_reports FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_reports FROM PUBLIC;
REVOKE ALL ON public.trading_reports FROM anon;
REVOKE ALL ON public.trading_reports FROM authenticated;
GRANT  ALL ON public.trading_reports TO service_role;

-- 켜졌는지 DB 에게 다시 묻는다. 위를 한 줄 빠뜨리면 그 표만 열려 있다
DO $$
DECLARE t TEXT; n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trading_health_checks', 'trading_operator_actions', 'trading_briefings', 'trading_reports'
  ] LOOP
    SELECT count(*) INTO n FROM pg_class
     WHERE oid = format('public.%I', t)::regclass AND relrowsecurity AND relforcerowsecurity;
    IF n <> 1 THEN RAISE EXCEPTION '% 의 RLS 가 안 켜졌다', t; END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.trading_operator_actions IS
  'AI 운영자가 한 일. append-only — 무엇을 했는지 다 남아야 맡길 범위를 넓힐 수 있다';
COMMENT ON COLUMN public.trading_operator_actions.handoff_log_id IS
  '사람에게 넘긴 업무(daily_logs.id). 새 할 일 표를 안 만들고 기존 업무를 가리킨다';
COMMENT ON TABLE public.trading_health_checks IS
  '점검 결과. status 에 unknown 이 있는 이유는 모르는 것을 괜찮다고 안 세기 위해서다';
