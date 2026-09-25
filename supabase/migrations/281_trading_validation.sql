-- 281: AI 트레이딩 1-B — 검증이 앉을 자리
--
-- 무엇을 만드나 (명세 §13)
--   과거 봉에 같은 함수를 돌린 결과, 사람이 따라 했을 때의 체결, 그것으로 맞춘 보정과
--   기대값 평균표, 그리고 한 번만 여는 Lockbox 기록.
--
-- 왜 결과에 판 번호가 줄줄이 붙나 (§14.1)
--   백테스트 성적은 **무엇으로 돌렸느냐에 전부 달려 있다.** 스펙이 바뀌고 보정이 바뀌고
--   체결 모델이 바뀌면 같은 구간에서도 다른 숫자가 나온다. 판을 안 적으면 한 달 뒤
--   「이 0.31R 은 어느 판의 성적인가」에 아무도 답할 수 없고, 답을 못 하면 그 숫자는
--   비교에 못 쓴다 — 즉 없는 것과 같다.
--
-- 왜 Lockbox 가 표인가 (§13.3)
--   한 번만 여는 규칙은 사람 기억으로 지킬 수 없다. 연 사실을 행으로 남기고
--   두 번째 열기는 DB 가 거절한다. 「한 번만」을 말이 아니라 잠금으로 만든다.
--
-- 보안 (LOOP.md 7절 S1)
--   새 표 전부 같은 판에서 RLS 를 켜고(ENABLE + FORCE) anon·authenticated 권한을 회수한다.
--   정책은 0개다 = 서비스롤 밖에서는 아무도 못 읽고 못 쓴다. `TO public` 은 쓰지 않는다.
--   279 와 같은 벽이고 같은 이유다 — 이 모듈은 소유자 한 사람만 본다(M11).
--   사본(CREATE TABLE AS)은 만들지 않는다.
--
-- 기존 행은 하나도 안 바뀐다 — 새 표 다섯만 만든다.
--
-- 되돌리기 (만든 순서의 반대):
--   DROP TABLE IF EXISTS public.trading_lockbox_opens;
--   DROP TABLE IF EXISTS public.trading_ev_models;
--   DROP TABLE IF EXISTS public.trading_calibrations;
--   DROP TABLE IF EXISTS public.trading_backtest_trades;
--   DROP TABLE IF EXISTS public.trading_backtest_runs;

-- ── 백테스트 실행 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_backtest_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code         TEXT        NOT NULL,
  decision_tf           TEXT        NOT NULL,
  judge                 TEXT        NOT NULL CHECK (judge IN ('rule', 'ml', 'jev')),
  -- 어느 구간을 돌렸나. 학습·검증·Lockbox 를 이름으로 가른다
  window_kind           TEXT        NOT NULL CHECK (window_kind IN ('train', 'validate', 'lockbox')),
  window_from           DATE        NOT NULL,
  window_to             DATE        NOT NULL,
  -- 무엇으로 돌렸나 (§14.1). 하나라도 비면 이 성적은 비교에 못 쓴다
  spec_version          TEXT        NOT NULL,
  calibration_version   TEXT,
  ev_model_version      TEXT,
  execution_model_version TEXT      NOT NULL,
  trading_logic_version TEXT,
  settings_version      INTEGER,
  -- 슬리피지 민감도. 같은 구간을 틱 수만 바꿔 여러 번 돌린다
  slippage_ticks        INTEGER     NOT NULL CHECK (slippage_ticks >= 0),
  -- 요약. 자세한 것은 trades 에 있다
  trade_count           INTEGER     NOT NULL DEFAULT 0,
  net_expectancy_r      NUMERIC(10,4),
  profit_factor         NUMERIC(10,4),
  max_drawdown_krw      NUMERIC(14,2),
  -- 한 봉 안에서 손절·목표가 모두 닿은 비율. 기준(기본 5%)을 넘으면 결과에 경고를 붙인다
  ambiguous_bar_ratio   NUMERIC(6,4),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  reason                TEXT,
  user_message          TEXT,
  -- 같은 구간·같은 판·같은 틱이면 결과가 같다. 두 번 돌릴 이유가 없다
  UNIQUE (contract_code, decision_tf, judge, window_kind, window_from, window_to,
          spec_version, execution_model_version, slippage_ticks)
);

CREATE INDEX IF NOT EXISTS idx_trading_backtest_runs_recent
  ON public.trading_backtest_runs (started_at DESC);

ALTER TABLE public.trading_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_backtest_runs FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_backtest_runs FROM PUBLIC;
REVOKE ALL ON public.trading_backtest_runs FROM anon;
REVOKE ALL ON public.trading_backtest_runs FROM authenticated;
GRANT  ALL ON public.trading_backtest_runs TO service_role;

COMMENT ON TABLE public.trading_backtest_runs IS
  '과거 봉에 같은 함수를 돌린 결과. 판 번호가 전부 붙어 있어야 비교에 쓸 수 있다(§14.1)';

-- ── 재현된 거래 한 건 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_backtest_trades (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID        NOT NULL REFERENCES public.trading_backtest_runs(id) ON DELETE CASCADE,
  -- 어느 봉의 판단에서 나왔나
  bar_close_at        TIMESTAMPTZ NOT NULL,
  trade_date          DATE        NOT NULL,
  direction           TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  trigger_id          TEXT,
  raw_score           JSONB,
  calibrated_prob     NUMERIC(6,5),
  -- 신호 시점 가격과 사람이 따라 했을 때의 체결가. 둘의 차가 곧 지연 비용이다
  signal_price        NUMERIC(12,2) NOT NULL,
  entry_price         NUMERIC(12,2),
  exit_price          NUMERIC(12,2),
  -- 왜 나갔나. 목표·손절·시간·당일청산·미체결
  exit_kind           TEXT        CHECK (exit_kind IN ('target', 'stop', 'time', 'session_close', 'not_filled')),
  entry_at            TIMESTAMPTZ,
  exit_at             TIMESTAMPTZ,
  -- 비용 포함 순손익. R 은 1회 위험 대비
  net_pnl_krw         NUMERIC(14,2),
  net_pnl_r           NUMERIC(10,4),
  cost_krw            NUMERIC(14,2),
  -- 한 봉 안에서 손절·목표가 모두 닿아 불리한 쪽으로 계산했나
  ambiguous_bar       BOOLEAN     NOT NULL DEFAULT false,
  -- 신호는 났는데 안 따랐다면 어떤 성과였나 (역선택 확인용, §13.2)
  counterfactual      BOOLEAN     NOT NULL DEFAULT false,
  UNIQUE (run_id, bar_close_at, direction)
);

CREATE INDEX IF NOT EXISTS idx_trading_backtest_trades_run
  ON public.trading_backtest_trades (run_id, trade_date, bar_close_at);

ALTER TABLE public.trading_backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_backtest_trades FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_backtest_trades FROM PUBLIC;
REVOKE ALL ON public.trading_backtest_trades FROM anon;
REVOKE ALL ON public.trading_backtest_trades FROM authenticated;
GRANT  ALL ON public.trading_backtest_trades TO service_role;

COMMENT ON COLUMN public.trading_backtest_trades.counterfactual IS
  '안 따랐을 때의 가상 성과. 좋은 신호를 놓치고 나쁜 신호만 따르는 경향(역선택)을 보는 자리(§13.2)';

-- ── 보정 모델 ──────────────────────────────────────────────
-- 방향별로 따로 맞춘다(D-09). 롱 신호에는 p_long, 숏 신호에는 p_short 를
-- 「청산 계획대로 했을 때 순이익 > 0 이었나」로 보정한다.
CREATE TABLE IF NOT EXISTS public.trading_calibrations (
  version           TEXT        NOT NULL,
  judge             TEXT        NOT NULL CHECK (judge IN ('rule', 'ml', 'jev')),
  direction         TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  method            TEXT        NOT NULL CHECK (method IN ('platt', 'isotonic')),
  -- Platt 은 파라미터 둘(a, b). 등위 회귀는 구간 목록이 들어온다
  params            JSONB       NOT NULL,
  -- 무엇으로 맞췄나. 검증 구간이 섞이면 그 성적은 거짓이다
  train_from        DATE        NOT NULL,
  train_to          DATE        NOT NULL,
  sample_count      INTEGER     NOT NULL CHECK (sample_count >= 0),
  brier_score       NUMERIC(8,6),
  base_rate_brier   NUMERIC(8,6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version, judge, direction)
);

ALTER TABLE public.trading_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_calibrations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_calibrations FROM PUBLIC;
REVOKE ALL ON public.trading_calibrations FROM anon;
REVOKE ALL ON public.trading_calibrations FROM authenticated;
GRANT  ALL ON public.trading_calibrations TO service_role;

COMMENT ON TABLE public.trading_calibrations IS
  '원점수를 확률로 옮기는 자. 이것이 없으면 신호를 내지 않는다(M3)';

-- ── 기대값 평균표 ──────────────────────────────────────────
-- 보정 확률 구간 → 비슷한 과거 신호의 실제 순손익 평균(§7.5).
-- **학습 구간 데이터로만** 만든다 — 검증 구간이 섞이면 그 검증은 자기 답을 보고 푸는 것이다(D-35).
CREATE TABLE IF NOT EXISTS public.trading_ev_models (
  version         TEXT        NOT NULL,
  judge           TEXT        NOT NULL CHECK (judge IN ('rule', 'ml', 'jev')),
  direction       TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  -- 구간 [bucket_from, bucket_to)
  bucket_from     NUMERIC(6,5) NOT NULL,
  bucket_to       NUMERIC(6,5) NOT NULL,
  sample_count    INTEGER     NOT NULL CHECK (sample_count >= 0),
  -- 비용이 이미 들어 있다. 신호 규칙에서 다시 빼지 않는다(D-34)
  mean_net_pnl_r  NUMERIC(10,4),
  train_from      DATE        NOT NULL,
  train_to        DATE        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version, judge, direction, bucket_from)
);

ALTER TABLE public.trading_ev_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_ev_models FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_ev_models FROM PUBLIC;
REVOKE ALL ON public.trading_ev_models FROM anon;
REVOKE ALL ON public.trading_ev_models FROM authenticated;
GRANT  ALL ON public.trading_ev_models TO service_role;

COMMENT ON COLUMN public.trading_ev_models.mean_net_pnl_r IS
  '비용 포함 평균 순손익(R). 표본이 없는 구간은 NULL — 값을 지어내지 않는다';

-- ── Lockbox 연 기록 ────────────────────────────────────────
-- 한 번만 여는 규칙을 사람 기억이 아니라 여기서 잠근다(§13.3).
-- 유일 키가 이름 하나이므로 두 번째 INSERT 는 DB 가 거절한다.
CREATE TABLE IF NOT EXISTS public.trading_lockbox_opens (
  name          TEXT        PRIMARY KEY,
  window_from   DATE        NOT NULL,
  window_to     DATE        NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 누가 열었나. AI 는 못 연다(§15.3) — 사람 id 가 반드시 있다
  opened_by     UUID        NOT NULL REFERENCES public.profiles(id),
  reason        TEXT        NOT NULL
);

ALTER TABLE public.trading_lockbox_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_lockbox_opens FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_lockbox_opens FROM PUBLIC;
REVOKE ALL ON public.trading_lockbox_opens FROM anon;
REVOKE ALL ON public.trading_lockbox_opens FROM authenticated;
GRANT  ALL ON public.trading_lockbox_opens TO service_role;

COMMENT ON TABLE public.trading_lockbox_opens IS
  '최종 검증 구간을 연 기록. 한 번만 연다 — 두 번째는 유일 키가 거절한다(§13.3)';
