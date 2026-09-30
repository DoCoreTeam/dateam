-- 295 내가 들어갔다고 적는 자리
--
-- 사용자 지시 2026-09-30: 「지금 관점으로 들어가야 하고 들어갔으면 체크하게 해줘
-- 얼마에 들어갔는지 확인하고 말이야」.
--
-- ## 왜 체결 표에 안 넣나
--
-- `trading_fills` 는 **증권사가 준 체결**이다. 매분 도는 수집이 그 표와 계좌를 대조해
-- 어긋나면 사람을 부른다. 거기에 사람이 손으로 적은 줄을 섞으면 그 대조가 늘 어긋나고,
-- 늘 어긋나는 경보는 아무도 안 본다.
--
-- 그래서 표를 따로 둔다. 이 표는 **내가 적은 기록**이고 증권사 기록이 아니다.
-- 화면도 그렇게 말한다.
--
-- ## 보안 (LOOP.md 7절 S1)
--
-- 이 판에서 RLS 를 켠다. 다른 trading_* 표와 같은 벽이다 —
-- anon·authenticated 에게 권한을 안 주고 service_role 만 준다. 정책은 안 만든다
-- (정책이 없으면 RLS 가 전부 막는다). 사람 확인은 서버 액션이 `tradingAccess()` 로 한다.
-- 사본(CREATE TABLE AS)은 만들지 않는다.

CREATE TABLE IF NOT EXISTS public.trading_manual_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 누가 적었나. 이 값으로만 읽고 쓴다 — 남의 줄은 안 보인다
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contract_code TEXT        NOT NULL,
  direction     TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  -- 얼마에 들어갔나. 0 이하는 값이 아니다
  entry_price   NUMERIC(12,2) NOT NULL CHECK (entry_price > 0),
  quantity      INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- 어느 판단을 보고 들어갔나. 없어도 된다 — 손으로 들어간 것도 기록이다
  judgment_id   UUID        REFERENCES public.trading_judgments(id) ON DELETE SET NULL,
  -- 그 판단이 말한 값. 나중에 「그대로 했나」를 볼 자리다
  stop_price    NUMERIC(12,2) CHECK (stop_price IS NULL OR stop_price > 0),
  target_price  NUMERIC(12,2) CHECK (target_price IS NULL OR target_price > 0),
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 나왔으면 언제 얼마에. 안 나왔으면 둘 다 NULL 이다
  exited_at     TIMESTAMPTZ,
  exit_price    NUMERIC(12,2) CHECK (exit_price IS NULL OR exit_price > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 나온 줄은 시각과 가격이 함께 있어야 한다. 하나만 있으면 손익을 못 센다
  CONSTRAINT trading_manual_entries_exit_pair
    CHECK ((exited_at IS NULL) = (exit_price IS NULL))
);

-- 열려 있는 줄을 찾는 질의가 가장 잦다
CREATE INDEX IF NOT EXISTS idx_trading_manual_entries_open
  ON public.trading_manual_entries (user_id, contract_code, entered_at DESC)
  WHERE exited_at IS NULL;

-- 한 사람이 한 월물에 열어 둘 수 있는 줄은 하나다.
-- 둘이면 「지금 뭘 들고 있나」에 답이 둘이 되고, 화면은 그중 하나를 골라 거짓말한다
CREATE UNIQUE INDEX IF NOT EXISTS uq_trading_manual_entries_one_open
  ON public.trading_manual_entries (user_id, contract_code)
  WHERE exited_at IS NULL;

ALTER TABLE public.trading_manual_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_manual_entries FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_manual_entries FROM PUBLIC;
REVOKE ALL ON public.trading_manual_entries FROM anon;
REVOKE ALL ON public.trading_manual_entries FROM authenticated;
GRANT  ALL ON public.trading_manual_entries TO service_role;
