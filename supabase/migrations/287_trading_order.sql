-- 287 Release 4 자동 주문 — 무장과 주문
--
-- 설계: docs/trading/RELEASE4_DESIGN.md
--
-- ## 왜 무장에 만료가 NOT NULL 인가
--
-- 켜 놓고 잊는 일을 **표가** 막는다. 코드가 만료를 검사하는 것만으로는, 그 검사를 지나는
-- 새 경로가 생기는 날 만료가 없는 것과 같아진다. 칸이 비어 있을 수 없으면 그 길이 없다.
--
-- ## 왜 주문에 유일 키가 있나
--
-- 주문은 되돌릴 수 없다. 크론이 겹치거나 응답이 늦어 다시 부르면 두 번 나간다.
-- `(신호 ID, 주문 종류)` 로 **넣는 데 성공한 실행만** KIS 를 부른다.
--
-- ## 되돌리기
--   DROP TABLE IF EXISTS public.trading_orders;
--   DROP TABLE IF EXISTS public.trading_arming_events;
--   DROP TABLE IF EXISTS public.trading_arming;

-- ── 무장 상태 — 환경당 한 행 ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_arming (
  env           TEXT        PRIMARY KEY CHECK (env IN ('real', 'paper')),
  armed         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- 만료. **NOT NULL** 이라 「만료 없는 무장」이 표에 못 들어간다
  expires_at    TIMESTAMPTZ NOT NULL,
  armed_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  armed_at      TIMESTAMPTZ,
  -- 무장했을 때 관문이 어땠나. 나중에 「왜 켰나」에 답할 자료
  gate_snapshot JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- 해제 사유. 스스로 풀렸으면 무엇 때문인지
  disarm_reason TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 무장 중이면 누가 언제 했는지가 있어야 한다
  CONSTRAINT trading_arming_armed_has_actor
    CHECK (NOT armed OR (armed_by IS NOT NULL AND armed_at IS NOT NULL))
);

-- ── 무장·해제 기록 (append-only) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_arming_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env           TEXT        NOT NULL CHECK (env IN ('real', 'paper')),
  action        TEXT        NOT NULL CHECK (action IN ('arm', 'disarm')),
  -- 사람이 한 무장·해제인가, 장치가 스스로 푼 것인가
  actor_kind    TEXT        NOT NULL CHECK (actor_kind IN ('human', 'system')),
  actor_user_id UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- **무장은 사람만 한다.** 장치는 해제만 할 수 있다
  CONSTRAINT trading_arming_events_only_human_arms
    CHECK (action = 'disarm' OR actor_kind = 'human'),
  CONSTRAINT trading_arming_events_human_has_id
    CHECK ((actor_kind = 'human') = (actor_user_id IS NOT NULL)),
  reason        TEXT        NOT NULL,
  gate_snapshot JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_arming_events_recent
  ON public.trading_arming_events (env, occurred_at DESC);

-- ── 낸 주문 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_orders (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 주문은 늘 신호를 물고 나간다. 신호 없는 임의 주문이 없다
  signal_id     UUID        NOT NULL REFERENCES public.trading_signals(id) ON DELETE RESTRICT,
  -- 진입인가 청산인가. 같은 신호에 각각 한 번씩
  order_kind    TEXT        NOT NULL CHECK (order_kind IN ('entry', 'exit')),
  env           TEXT        NOT NULL CHECK (env IN ('real', 'paper')),
  contract_code TEXT        NOT NULL,
  direction     TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  -- **늘 1이다** (D-11). 2 이상은 표가 거절한다
  quantity      INTEGER     NOT NULL CHECK (quantity = 1),
  -- 시장가면 0
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- 무엇 때문에 냈나 (청산 계기: stop·target·time·session_close)
  trigger       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'unknown')),
  -- KIS 가 준 주문번호. 받았으면 나간 것이다
  broker_order_no TEXT,
  reason        TEXT,
  user_message  TEXT,
  -- §14.2 시각. 주문 지연을 재려면 있어야 한다
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 신호에 같은 종류 주문이 두 번 안 나간다
  UNIQUE (signal_id, order_kind)
);

CREATE INDEX IF NOT EXISTS idx_trading_orders_recent
  ON public.trading_orders (requested_at DESC, status);

-- ── 잠금 — 세 표 전부 같은 판에서 (S1) ─────────────────────
--
-- 반복문으로 줄이지 않는다. `lib/policy/rls-baseline.test.ts` 가 마이그레이션 글을 읽는다.

ALTER TABLE public.trading_arming ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_arming FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_arming FROM PUBLIC;
REVOKE ALL ON public.trading_arming FROM anon;
REVOKE ALL ON public.trading_arming FROM authenticated;
GRANT  ALL ON public.trading_arming TO service_role;

ALTER TABLE public.trading_arming_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_arming_events FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_arming_events FROM PUBLIC;
REVOKE ALL ON public.trading_arming_events FROM anon;
REVOKE ALL ON public.trading_arming_events FROM authenticated;
GRANT  ALL ON public.trading_arming_events TO service_role;

ALTER TABLE public.trading_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_orders FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_orders FROM PUBLIC;
REVOKE ALL ON public.trading_orders FROM anon;
REVOKE ALL ON public.trading_orders FROM authenticated;
GRANT  ALL ON public.trading_orders TO service_role;

DO $$
DECLARE t TEXT; n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trading_arming', 'trading_arming_events', 'trading_orders'] LOOP
    SELECT count(*) INTO n FROM pg_class
     WHERE oid = format('public.%I', t)::regclass AND relrowsecurity AND relforcerowsecurity;
    IF n <> 1 THEN RAISE EXCEPTION '% 의 RLS 가 안 켜졌다', t; END IF;
  END LOOP;
END $$;

-- 두 환경 다 **해제 상태로** 심는다. 만료는 과거로 둬서 「무장 아님」이 두 겹으로 참이다
INSERT INTO public.trading_arming (env, armed, expires_at)
VALUES ('paper', FALSE, now() - interval '1 day'),
       ('real',  FALSE, now() - interval '1 day')
ON CONFLICT (env) DO NOTHING;

COMMENT ON TABLE public.trading_arming IS
  '자동 주문 무장. 기본 해제이고 만료가 NOT NULL 이라 「켜 놓고 잊기」를 표가 막는다';
COMMENT ON CONSTRAINT trading_arming_events_only_human_arms ON public.trading_arming_events IS
  '무장은 사람만 한다. 장치는 해제만 — §15.3 「실행 방식(주문 여부)」은 AI 가 못 바꾼다';
COMMENT ON COLUMN public.trading_orders.quantity IS
  '늘 1이다(D-11). 2 이상을 허용하는 릴리스에서 부분 체결과 함께 다시 설계한다';
