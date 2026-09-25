-- 282: AI 트레이딩 1-C — 신호·알림·체결이 앉을 자리
--
-- 무엇을 만드나 (명세 §10~§12 · §14)
--   모든 관문을 통과해 나간 신호, 그 신호에 붙는 알림, 사람이 실제로 한 거래,
--   그리고 지금 포지션이 무엇인가.
--
-- 왜 알림이 표인가 (§14.3 D-33)
--   알림을 코드에서 바로 보내면 크론이 두 번 도는 날 두 번 간다. 유일 키만으로는
--   저장을 막을 뿐 **보내는 것**은 못 막는다. 그래서 보내기 전에 대기 표에 넣고,
--   넣는 데 성공한 실행만 보내며, 보낸 뒤 `sent` 로 표시한다.
--   실패해도 줄이 남아 다음 실행이 집는다 — 알림이 조용히 사라지지 않는다.
--
-- 왜 시각이 여섯 칸인가 (§14.2)
--   봉 마감 → 발송 → 열람 → 주문 → 체결. 한 칸으로 「지연 3분」이라고만 적으면
--   그 3분이 서버가 느린 건지 사람이 늦게 본 건지 시장이 안 받아 준 건지 모른다.
--   고칠 수 있는 것과 없는 것이 섞이면 아무것도 못 고친다.
--
-- 왜 포지션의 진실이 KIS 인가 (§11)
--   우리 기록은 「그랬을 것이다」이고 계좌는 「그렇다」이다. 둘이 다르면 계좌가 맞다.
--   다른 상태(`reconciliation_required`)는 **사람이 화면에서 확인해야** 풀린다 —
--   코드가 스스로 풀면 어긋난 채로 다음 거래가 나간다.
--
-- 보안 (LOOP.md 7절 S1)
--   새 표 전부 같은 판에서 RLS 를 켜고(ENABLE + FORCE) anon·authenticated 권한을 회수한다.
--   정책은 0개다 = 서비스롤 밖에서는 아무도 못 읽고 못 쓴다. `TO public` 은 쓰지 않는다.
--   279·281 과 같은 벽이다. 사본(CREATE TABLE AS)은 만들지 않는다.
--
-- 되돌리기 (만든 순서의 반대):
--   DROP TABLE IF EXISTS public.trading_position_events;
--   DROP TABLE IF EXISTS public.trading_fills;
--   DROP TABLE IF EXISTS public.trading_notifications;
--   DROP TABLE IF EXISTS public.trading_signals;

-- ── 신호 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_signals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 어느 판단에서 나왔나. 판단 없이 신호가 설 수 없다
  judgment_id           UUID        NOT NULL REFERENCES public.trading_judgments(id),
  contract_code         TEXT        NOT NULL,
  direction             TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  -- 신호가 난 시점의 기준 가격과 청산 계획(§8)
  reference_price       NUMERIC(12,2) NOT NULL,
  stop_price            NUMERIC(12,2) NOT NULL,
  target_price          NUMERIC(12,2) NOT NULL,
  chase_limit_price     NUMERIC(12,2) NOT NULL,
  time_exit_minutes     INTEGER     NOT NULL,
  session_close_at      TIMESTAMPTZ NOT NULL,
  -- 무엇을 근거로 냈나
  calibrated_prob       NUMERIC(6,5),
  net_expected_value_r  NUMERIC(10,4),
  risk_per_trade_krw    NUMERIC(14,2) NOT NULL,
  -- 판 번호(§14.1). 없으면 이 신호가 어느 규칙으로 나갔는지 모른다
  signal_rules_version  TEXT        NOT NULL,
  calibration_version   TEXT,
  ev_model_version      TEXT,
  -- 시각 여섯 (§14.2). 이 칸들이 지연을 네 구간으로 가른다
  bar_close_at          TIMESTAMPTZ NOT NULL,
  notify_sent_at        TIMESTAMPTZ,
  opened_at             TIMESTAMPTZ,
  ack_at                TIMESTAMPTZ,
  order_at              TIMESTAMPTZ,
  fill_at               TIMESTAMPTZ,
  -- 사람이 어떻게 했나
  result                TEXT        CHECK (result IN ('followed', 'late', 'skipped', 'expired')),
  -- 사용자가 「손절 설정함」을 눌렀나. 검증이 아니라 자기 입력이다(§11 D-15)
  user_reported_stop    NUMERIC(12,2),
  user_reported_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 판단에서 같은 규칙 판으로 신호가 두 번 나가지 않는다(§14.3)
  UNIQUE (judgment_id, signal_rules_version)
);

CREATE INDEX IF NOT EXISTS idx_trading_signals_recent
  ON public.trading_signals (bar_close_at DESC);

ALTER TABLE public.trading_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_signals FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_signals FROM PUBLIC;
REVOKE ALL ON public.trading_signals FROM anon;
REVOKE ALL ON public.trading_signals FROM authenticated;
GRANT  ALL ON public.trading_signals TO service_role;

COMMENT ON COLUMN public.trading_signals.user_reported_stop IS
  '사용자가 입력한 손절가. 시스템은 이것을 「보호됨」으로 취급하지 않는다(§11 D-15)';

-- ── 알림 대기 표 (아웃박스) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID        REFERENCES public.trading_signals(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN (
                  'signal', 'exit', 'safety', 'daily_limit', 'session_close', 'protection_breached')),
  -- 사람이 읽을 제목과 본문. 여기에 계좌번호나 내부 구조를 싣지 않는다
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  -- 조용한 실패 금지. 왜 못 보냈는지가 남아야 다음 실행이 판단한다
  reason        TEXT,
  user_message  TEXT,
  -- 같은 신호에 같은 종류가 두 번 안 들어간다(§14.3)
  UNIQUE (signal_id, kind)
);

-- 아직 안 보낸 것을 오래된 순으로 집는다
CREATE INDEX IF NOT EXISTS idx_trading_notifications_pending
  ON public.trading_notifications (status, queued_at) WHERE status <> 'sent';

ALTER TABLE public.trading_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_notifications FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_notifications FROM PUBLIC;
REVOKE ALL ON public.trading_notifications FROM anon;
REVOKE ALL ON public.trading_notifications FROM authenticated;
GRANT  ALL ON public.trading_notifications TO service_role;

COMMENT ON TABLE public.trading_notifications IS
  '알림 대기 표. 보내기 전에 여기 넣고, 넣는 데 성공한 실행만 보낸다 — 두 번 가지 않게(§14.3 D-33)';

-- ── 체결 ───────────────────────────────────────────────────
-- KIS 주문체결내역에서 읽어 온다. **우리가 주문한 것이 아니라 사람이 한 것**이다(C1).
CREATE TABLE IF NOT EXISTS public.trading_fills (
  -- KIS 체결 번호(주문번호 + 체결 순번). 같은 체결이 두 번 안 들어간다(§14.3)
  order_no      TEXT        NOT NULL,
  fill_seq      TEXT        NOT NULL,
  contract_code TEXT        NOT NULL,
  side          TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity      INTEGER     NOT NULL CHECK (quantity > 0),
  price         NUMERIC(12,2) NOT NULL,
  -- KIS 가 말한 주문 시각과 체결 시각
  order_at      TIMESTAMPTZ,
  filled_at     TIMESTAMPTZ NOT NULL,
  -- 어느 신호를 따른 것인가. 신호 없이 한 거래는 null(manual_trade)
  signal_id     UUID        REFERENCES public.trading_signals(id) ON DELETE SET NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_no, fill_seq)
);

CREATE INDEX IF NOT EXISTS idx_trading_fills_recent
  ON public.trading_fills (contract_code, filled_at DESC);

ALTER TABLE public.trading_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_fills FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_fills FROM PUBLIC;
REVOKE ALL ON public.trading_fills FROM anon;
REVOKE ALL ON public.trading_fills FROM authenticated;
GRANT  ALL ON public.trading_fills TO service_role;

COMMENT ON TABLE public.trading_fills IS
  'KIS 주문체결내역에서 읽은 사람의 거래. 이 시스템은 주문하지 않는다(C1 · M1)';

-- ── 포지션 사건 ────────────────────────────────────────────
-- 상태를 덮어쓰지 않고 사건을 쌓는다. 「언제부터 어긋났나」를 나중에 물을 수 있어야 한다.
CREATE TABLE IF NOT EXISTS public.trading_position_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code     TEXT        NOT NULL,
  position_state    TEXT        NOT NULL CHECK (position_state IN (
                      'flat', 'entry_pending', 'holding', 'exit_pending', 'reconciliation_required')),
  protection_state  TEXT        NOT NULL CHECK (protection_state IN (
                      'none', 'unknown', 'user_reported', 'breached')),
  quantity          INTEGER     NOT NULL DEFAULT 0,
  direction         TEXT        CHECK (direction IN ('long', 'short')),
  average_price     NUMERIC(12,2),
  -- 왜 이 상태가 됐나. 사람이 화면에서 푼 것도 여기 남는다
  reason            TEXT        NOT NULL,
  -- 사람이 확인해 풀었으면 누가
  resolved_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_position_events_recent
  ON public.trading_position_events (contract_code, occurred_at DESC);

ALTER TABLE public.trading_position_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_position_events FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_position_events FROM PUBLIC;
REVOKE ALL ON public.trading_position_events FROM anon;
REVOKE ALL ON public.trading_position_events FROM authenticated;
GRANT  ALL ON public.trading_position_events TO service_role;

COMMENT ON COLUMN public.trading_position_events.resolved_by IS
  'reconciliation_required 는 사람이 화면에서 확인해야 풀린다. 코드가 스스로 풀지 않는다(§11)';
