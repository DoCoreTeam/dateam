-- 289 트레이딩 이벤트 캘린더 (명세 §6.6 [필수: Release 1은 수동])
--
-- 금통위·FOMC·CPI 발표 앞뒤로는 새 신호를 내지 않는다(SR-05).
-- Release 1 에서는 관리자가 화면에서 직접 등록하고, 자동 수집은 Release 2 다.
--
-- 왜 기존 calendar_events 를 안 쓰나: 그 표는 사람 일정이다. 소유자·참석자·되돌리기가
-- 붙어 있고 조직 범위로 걸러진다. 시장 이벤트는 그런 것이 없고 대신 **시각 하나가 정확해야**
-- 한다. 한 표에 두 성격을 담으면 걸러 내는 조건이 양쪽 모두에게 어색해진다.

CREATE TABLE IF NOT EXISTS public.trading_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 무엇이 언제. 시각은 항상 UTC 로 저장하고 화면이 KST 로 그린다
  name        TEXT        NOT NULL CHECK (btrim(name) <> ''),
  occurs_at   TIMESTAMPTZ NOT NULL,
  -- 어디서 왔나. 지금은 사람이 넣은 것뿐이고 Release 2 에서 'auto' 가 생긴다
  source      TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 이벤트를 두 번 넣지 못하게. 시각이 1분만 달라도 다른 줄이 되지만,
  -- 그것은 사람이 화면에서 보고 지울 수 있다
  UNIQUE (name, occurs_at)
);

-- 판단은 「지금 시각 앞뒤에 이벤트가 있나」를 묻는다. 시각 축 하나면 된다
CREATE INDEX IF NOT EXISTS idx_trading_events_at
  ON public.trading_events (occurs_at DESC);

-- S1 잠금은 표를 만든 **같은 판**에서 건다.
-- 나중에 따로 걸면 그 사이에 열려 있고, 그 사이가 얼마나 긴지는 아무도 모른다.
ALTER TABLE public.trading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_events FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_events FROM PUBLIC;
REVOKE ALL ON public.trading_events FROM anon;
REVOKE ALL ON public.trading_events FROM authenticated;
GRANT  ALL ON public.trading_events TO service_role;

-- 정책을 하나도 안 만든다. 서버(service_role)만 읽고 쓰며 RLS 를 지나간다.
-- `TO public USING (true)` 를 쓰면 정책이 있으니 잠긴 것처럼 보이지만 실제로는 열려 있다.

COMMENT ON TABLE public.trading_events IS
  '신호 금지 구간을 만드는 시장 이벤트. Release 1 은 관리자가 화면에서 직접 등록(§6.6)';
COMMENT ON COLUMN public.trading_events.occurs_at IS
  '이벤트 시각(UTC). 앞 N분·뒤 M분이 SR-05 금지 구간이고 N·M 은 설정값';
