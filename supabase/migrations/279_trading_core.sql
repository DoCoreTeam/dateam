-- 279: AI 트레이딩 1-A — 데이터와 판단 기록이 앉을 자리
--
-- 무엇을 만드나
--   명세 newplan/TRD/AI_TRADING_SPEC.md v0.8.1 §14.5 의 표 열 개다.
--   이름과 칼럼은 그 절을 그대로 따른다. 여기서 이름을 바꾸면 명세와 코드가 갈리고,
--   갈린 다음에는 어느 쪽이 맞는지 아무도 모른다.
--
-- 왜 지금 열 개를 한꺼번에 만드나
--   1-A 는 「봉을 모으고 판단을 적는다」 하나의 일이고, 그 일은 표 하나로는 안 선다.
--   월물을 모르면 봉을 어디에 적을지 모르고, 캘린더를 모르면 어느 봉이 판단 대상인지 모르고,
--   선점 표가 없으면 크론 둘이 같은 봉에 Jev 를 두 번 부른다.
--   나눠 만들면 그 사이 판이 반쪽으로 돌아가는 구간이 생긴다 — 그 구간에 모은 데이터는
--   나중에 쓸 수 없다(결측인지 미구현인지 구분이 안 된다).
--
-- 여기 없는 것 — 일부러 없다
--   · 신호·알림·체결·거래·백테스트 표: 1-B·1-C 것이다. 명세 「구현 범위 잠금」이
--     빈 표조차 만들지 말라고 한다. 빈 표가 있으면 다음 사람이 「쓰는 데가 있나」를 찾는다
--   · trading_audit_log: 이 저장소에는 이미 감사 자리가 있다(activity_log 와 265 의 범용
--     감사 트리거). 명세 §14.5 가 「기존 감사 표를 쓴다, 없으면 만든다」이므로 만들지 않는다
--   · 결측 봉 표: 결측은 그 분의 실행 기록(trading_job_runs.reason)에 남는다.
--     봉이 없는 것과 봉을 못 받은 것을 두 표로 나누면 둘이 어긋나는 날이 온다
--
-- 보안 (LOOP.md 7절 S1)
--   열 표 전부 같은 판에서 RLS 를 켜고(ENABLE + FORCE) anon·authenticated 권한을 회수한다.
--   정책은 0개다 = 서비스롤 밖에서는 아무도 못 읽고 못 쓴다. `TO public` 은 쓰지 않는다.
--   왜 사용자 키로 읽게 두지 않나: 이 모듈은 **소유자 한 사람만** 본다(M11). 소유자 판정은
--   trading_settings 의 owner_user_id 에 있고 그 값은 설정이라 바뀐다. RLS 정책 안에
--   설정을 읽는 서브쿼리를 넣으면 봉 한 줄을 읽을 때마다 설정 표를 훑는다(분당 수백 줄).
--   그래서 264(ai_provider_keys)·277(access_grant)과 같은 벽을 쓴다 — 읽기도 쓰기도
--   앱 서버가 소유자를 확인한 뒤에만 한다. 확인 자리는 apps/web/lib/trading/access.ts.
--   사본(CREATE TABLE AS)은 만들지 않는다.
--
--   비밀값(KIS 앱키·시크릿·계좌번호·접근토큰)은 평문으로 안 들어간다. _enc 로 끝나는 칼럼은
--   AES-256-GCM 봉투(JSONB)만 받는다. 암호화·복호화는 서버 모듈에서만 한다.
--
-- 기존 행은 하나도 안 바뀐다 — 새 표 열 개만 만들고 기존 표는 profiles 를 참조만 한다.
--
-- 되돌리기 (만든 순서의 반대):
--   DROP TABLE IF EXISTS public.trading_broker_credentials;
--   DROP TABLE IF EXISTS public.trading_broker_tokens;
--   DROP TABLE IF EXISTS public.trading_settings;
--   DROP TABLE IF EXISTS public.trading_day_config;
--   DROP TABLE IF EXISTS public.trading_job_runs;
--   DROP TABLE IF EXISTS public.trading_judgments;
--   DROP TABLE IF EXISTS public.trading_bars;
--   DROP TABLE IF EXISTS public.trading_session_calendar;
--   DROP TABLE IF EXISTS public.trading_contracts;
--   DROP TABLE IF EXISTS public.trading_instruments;

-- ── 상품 — 정규와 미니 ─────────────────────────────────────
-- 승수·호가단위·호가가치는 거래소 규격이다. 금액을 코드나 문서에 고정하지 않고(M6)
-- 여기서 읽어 계산한다 — 규격이 바뀌면 고칠 자리가 한 곳이다.
CREATE TABLE IF NOT EXISTS public.trading_instruments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  root        TEXT        NOT NULL CHECK (root IN ('KOSPI200', 'MINI_KOSPI200')),
  -- 1포인트가 몇 원인가. 정규 250,000 · 미니 50,000
  multiplier  INTEGER     NOT NULL CHECK (multiplier > 0),
  -- 최소 호가 간격(포인트). 정규 0.05 · 미니 0.02
  tick_size   NUMERIC(8,4) NOT NULL CHECK (tick_size > 0),
  -- 1틱이 몇 원인가. multiplier * tick_size 와 같아야 하지만 거래소 고시값을 그대로 적는다
  tick_value  INTEGER     NOT NULL CHECK (tick_value > 0),
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root)
);

ALTER TABLE public.trading_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_instruments FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_instruments FROM PUBLIC;
REVOKE ALL ON public.trading_instruments FROM anon;
REVOKE ALL ON public.trading_instruments FROM authenticated;
GRANT  ALL ON public.trading_instruments TO service_role;

COMMENT ON TABLE public.trading_instruments IS
  'KOSPI200 지수선물 상품 규격(승수·호가단위). 금액은 이 값으로 계산하고 코드에 고정하지 않는다';

-- ── 월물 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_contracts (
  -- KIS 종목코드. 이것이 봉·판단이 가리키는 이름이다
  code             TEXT        PRIMARY KEY,
  instrument_id    UUID        NOT NULL REFERENCES public.trading_instruments(id),
  -- 만기 달의 1일로 적는다(예: 2026-12-01). 달이 곧 월물이다
  expiry_month     DATE        NOT NULL,
  last_trading_day DATE        NOT NULL,
  -- 지금의 근월물인가. 교체일에 이 값이 옮겨 간다
  is_front         BOOLEAN     NOT NULL DEFAULT false,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 이 사실을 실제로 알게 된 시각(§6.5). 백테스트가 미래를 안 보게 하는 자물쇠다
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, expiry_month)
);

-- 「지금 근월물이 무엇인가」는 매분 묻는 질문이다
CREATE INDEX IF NOT EXISTS idx_trading_contracts_front
  ON public.trading_contracts (instrument_id, is_front, expiry_month);

ALTER TABLE public.trading_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_contracts FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_contracts FROM PUBLIC;
REVOKE ALL ON public.trading_contracts FROM anon;
REVOKE ALL ON public.trading_contracts FROM authenticated;
GRANT  ALL ON public.trading_contracts TO service_role;

COMMENT ON TABLE public.trading_contracts IS
  '만기별 종목. KIS 종목정보로 매 거래일 장 시작 전에 갱신한다(§6.3)';

-- ── 세션 캘린더 ────────────────────────────────────────────
-- 왜 시각을 표에 두나: 청산 시각이 고정값이 아니기 때문이다(§6.3).
-- 만기일은 접속매매가 15:20 에 끝나고, 개장 시간이 바뀌는 날도 있다.
-- 화면이나 코드에 15:20 을 적어 두면 그런 날마다 틀린 값을 그린다.
CREATE TABLE IF NOT EXISTS public.trading_session_calendar (
  trade_date         DATE        NOT NULL,
  session            TEXT        NOT NULL CHECK (session IN ('regular', 'night')),
  -- 개장 전 단일가 시작. 이 구간의 봉은 판단에 쓰지 않는다
  open_auction_start TIMESTAMPTZ,
  -- 접속매매 시작·종료. 판단 대상 구간은 이 둘 사이뿐이다
  continuous_start   TIMESTAMPTZ NOT NULL,
  continuous_end     TIMESTAMPTZ NOT NULL,
  -- 장 마감 단일가 종료. 만기일처럼 단일가가 없는 날은 NULL
  close_auction_end  TIMESTAMPTZ,
  note               TEXT,
  source             TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('kis', 'manual')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_date, session)
);

ALTER TABLE public.trading_session_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_session_calendar FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_session_calendar FROM PUBLIC;
REVOKE ALL ON public.trading_session_calendar FROM anon;
REVOKE ALL ON public.trading_session_calendar FROM authenticated;
GRANT  ALL ON public.trading_session_calendar TO service_role;

COMMENT ON COLUMN public.trading_session_calendar.continuous_end IS
  '접속매매 종료. 당일 청산 알림 시각은 이 값에서 N분을 뺀 값이고 고정 시각이 아니다(§6.3)';

-- ── 봉 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_bars (
  -- 월물 표에 외래키를 안 건다. 종목 정보 동기화가 늦은 날 봉 저장이 함께 실패하면
  -- 그날은 통째로 결측이 되고, 결측인지 미구현인지 나중에 구분할 수 없다.
  -- 모으는 일이 먼저다 — 짝이 안 맞는 code 는 화면이 「모르는 월물」로 보여 준다
  contract_code  TEXT        NOT NULL,
  tf             TEXT        NOT NULL CHECK (tf IN ('1m', '5m', '15m')),
  bar_start_at   TIMESTAMPTZ NOT NULL,
  bar_close_at   TIMESTAMPTZ NOT NULL,
  open           NUMERIC(12,2) NOT NULL,
  high           NUMERIC(12,2) NOT NULL,
  low            NUMERIC(12,2) NOT NULL,
  close          NUMERIC(12,2) NOT NULL,
  -- 거래량 0 인 분도 정상 봉이다. 거래량으로 확정을 판단하지 않는다(§6.2)
  volume         INTEGER     NOT NULL DEFAULT 0 CHECK (volume >= 0),
  open_interest  INTEGER,
  -- 최우선 호가. 분봉 조회에는 없고 호가 조회로 따로 받아 채운다 — 못 받으면 NULL
  best_bid       NUMERIC(12,2),
  best_ask       NUMERIC(12,2),
  -- 봉이 마감된 것을 실제로 확인한 시각과, 그 값을 알 수 있게 된 시각(§6.2·§6.5)
  confirmed_at   TIMESTAMPTZ NOT NULL,
  available_at   TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL CHECK (source IN ('kis', 'import')),
  -- 고치면 덮어쓰지 않고 판을 올린다(§6.5)
  data_version   INTEGER     NOT NULL DEFAULT 1,
  UNIQUE (contract_code, tf, bar_start_at)
);

-- 판단은 「이 월물의 이 봉 종류를 최근부터」 읽는다. 지표 계산도 같은 축이다
CREATE INDEX IF NOT EXISTS idx_trading_bars_recent
  ON public.trading_bars (contract_code, tf, bar_start_at DESC);

ALTER TABLE public.trading_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_bars FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_bars FROM PUBLIC;
REVOKE ALL ON public.trading_bars FROM anon;
REVOKE ALL ON public.trading_bars FROM authenticated;
GRANT  ALL ON public.trading_bars TO service_role;

COMMENT ON TABLE public.trading_bars IS
  '확정 봉. 백테스트와 실시간이 같은 출처·같은 규칙의 이 표를 읽는다(M4)';

-- ── 판단 ───────────────────────────────────────────────────
-- 이 표가 선점 자리이기도 하다(§14.3). 판단을 하기 **전에** pending 으로 한 줄 넣고,
-- 넣는 데 성공한 실행만 Jev 를 부른다. 유일 키만으로는 두 크론이 동시에 외부를 부를 수 있다.
CREATE TABLE IF NOT EXISTS public.trading_judgments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code         TEXT        NOT NULL,
  decision_tf           TEXT        NOT NULL CHECK (decision_tf IN ('1m', '5m', '15m')),
  bar_close_at          TIMESTAMPTZ NOT NULL,
  spec_version          TEXT        NOT NULL,
  judge                 TEXT        NOT NULL CHECK (judge IN ('rule', 'ml', 'jev')),
  -- 어느 진입 조건이 이 판단을 부르게 했나. 조건 정의는 설정 레지스트리에 있다
  trigger_id            TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'abstain', 'failed')),
  -- 선점한 시각. 여기서 60초 넘게 pending 이면 다음 실행이 이어받는다
  claimed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 판단기의 **원점수**다(M3). p_long · p_short · p_hold · enter_now.
  -- 보정은 1-B 것이고, 보정 전 값으로 신호를 내지 않는다
  raw_score             JSONB,
  abstain_reason        TEXT,
  -- 판단에 넣은 입력의 해시. 같은 입력에 같은 답이 나오는지 나중에 확인할 자리다
  state_hash            TEXT,
  jev_model_version     TEXT,
  jev_prompt_version    TEXT,
  -- lib/trading/** 의 해시. 장중에 이 값이 바뀌면 그날 판단은 구성 변경일로 따로 센다(§14.4)
  trading_logic_version TEXT,
  settings_version      INTEGER,
  decision_at           TIMESTAMPTZ,
  ai_request_at         TIMESTAMPTZ,
  ai_response_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 봉 하나에 판단기 하나당 한 줄. 이것이 선점의 근거다
  UNIQUE (contract_code, decision_tf, bar_close_at, spec_version, judge)
);

-- 화면은 최근 판단부터 본다
CREATE INDEX IF NOT EXISTS idx_trading_judgments_recent
  ON public.trading_judgments (bar_close_at DESC, judge);
-- 이어받기는 「오래 pending 인 것」을 찾는다
CREATE INDEX IF NOT EXISTS idx_trading_judgments_stale
  ON public.trading_judgments (status, claimed_at) WHERE status = 'pending';

ALTER TABLE public.trading_judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_judgments FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_judgments FROM PUBLIC;
REVOKE ALL ON public.trading_judgments FROM anon;
REVOKE ALL ON public.trading_judgments FROM authenticated;
GRANT  ALL ON public.trading_judgments TO service_role;

COMMENT ON COLUMN public.trading_judgments.raw_score IS
  '판단기 원점수. 신호 판단은 보정 후 값으로만 하고, 보정이 없으면 신호를 내지 않는다(M3)';

-- ── 크론 실행 ──────────────────────────────────────────────
-- 왜 실행을 기록하나: 실행은 가끔 빠지고 가끔 두 번 된다(§4). 빠진 것을 「봉이 없었다」로
-- 읽으면 수집 공백과 시장 공백이 섞인다. 결측 봉도 여기 reason 으로 남는다.
CREATE TABLE IF NOT EXISTS public.trading_job_runs (
  job_name         TEXT        NOT NULL,
  -- 예정된 분(초는 0). 실제 실행 시각이 아니라 **예정**이라 중복을 막을 수 있다
  scheduled_minute TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('running', 'done', 'failed', 'skipped')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  -- 조용한 실패 금지(M12). 기계가 읽는 사유와 사람이 읽는 문장을 따로 남긴다
  reason           TEXT,
  user_message     TEXT,
  UNIQUE (job_name, scheduled_minute)
);

CREATE INDEX IF NOT EXISTS idx_trading_job_runs_recent
  ON public.trading_job_runs (job_name, scheduled_minute DESC);

ALTER TABLE public.trading_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_job_runs FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_job_runs FROM PUBLIC;
REVOKE ALL ON public.trading_job_runs FROM anon;
REVOKE ALL ON public.trading_job_runs FROM authenticated;
GRANT  ALL ON public.trading_job_runs TO service_role;

-- ── 거래일 고정 ────────────────────────────────────────────
-- 배포도 전략을 바꾼다(§14.4). 거래일이 시작될 때 로직 해시·설정 판·근월물을 굳혀 두고,
-- 장중에 그 값이 달라지면 그날은 「구성 변경일」로 따로 센다.
CREATE TABLE IF NOT EXISTS public.trading_day_config (
  trade_date            DATE        PRIMARY KEY,
  trading_logic_version TEXT        NOT NULL,
  settings_version      INTEGER     NOT NULL,
  front_contract_code   TEXT        NOT NULL,
  frozen_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trading_day_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_day_config FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_day_config FROM PUBLIC;
REVOKE ALL ON public.trading_day_config FROM anon;
REVOKE ALL ON public.trading_day_config FROM authenticated;
GRANT  ALL ON public.trading_day_config TO service_role;

-- ── 설정 ───────────────────────────────────────────────────
-- 매매에 쓰이는 값은 전부 여기 있고 설정 화면에서 바꾼다(M7).
-- 왜 (key, version) 이 유일 키인가: 덮어쓰지 않고 판을 쌓아야 「그날 무엇으로 판단했나」가
-- 남는다. 지금 값은 effective_trade_date 가 지난 것 중 version 이 가장 큰 줄이다.
-- 전략 변경은 다음 거래일부터 — 그 규칙이 effective_trade_date 하나로 선다.
CREATE TABLE IF NOT EXISTS public.trading_settings (
  key                  TEXT        NOT NULL,
  value                JSONB       NOT NULL,
  version              INTEGER     NOT NULL CHECK (version > 0),
  source               TEXT        NOT NULL CHECK (source IN ('init', 'admin', 'ai')),
  reason               TEXT,
  changed_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 이 날부터 유효하다. 신호를 막는 안전 조치만 당일 적용이고 나머지는 다음 거래일부터
  effective_trade_date DATE        NOT NULL,
  UNIQUE (key, version)
);

CREATE INDEX IF NOT EXISTS idx_trading_settings_effective
  ON public.trading_settings (key, effective_trade_date DESC, version DESC);

ALTER TABLE public.trading_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_settings FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_settings FROM PUBLIC;
REVOKE ALL ON public.trading_settings FROM anon;
REVOKE ALL ON public.trading_settings FROM authenticated;
GRANT  ALL ON public.trading_settings TO service_role;

COMMENT ON TABLE public.trading_settings IS
  '설정 레지스트리의 값과 이력. 덮어쓰지 않고 판을 쌓는다 — 그날 무엇으로 판단했는지가 남아야 한다';

-- ── KIS 접근 토큰 — 환경당 한 행 ───────────────────────────
-- 왜 한 행인가(§17.2 D-51): 실행이 저마다 토큰을 받으면 KIS 의 1분 1회 재발급 제한에 걸려
-- 조회가 통째로 막힌다. 모든 실행이 이 한 행만 쓰고, 만료가 임박했을 때
-- **잠금을 잡은 하나만** 재발급한다. 상시 워커는 필요 없다.
CREATE TABLE IF NOT EXISTS public.trading_broker_tokens (
  env          TEXT        PRIMARY KEY CHECK (env IN ('real', 'paper')),
  -- AES-256-GCM 봉투. 평문 토큰은 어떤 칼럼에도 안 들어간다
  token_enc    JSONB       NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  -- 지금 재발급을 맡은 실행. locked_until 이 지나면 남이 이어받는다
  lock_holder  TEXT,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trading_broker_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_broker_tokens FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_broker_tokens FROM PUBLIC;
REVOKE ALL ON public.trading_broker_tokens FROM anon;
REVOKE ALL ON public.trading_broker_tokens FROM authenticated;
GRANT  ALL ON public.trading_broker_tokens TO service_role;

-- ── KIS 자격증명 — 환경당 한 행 ────────────────────────────
-- 조회 전용 앱키다. 주문 계열은 구현하지 않는다(M1).
CREATE TABLE IF NOT EXISTS public.trading_broker_credentials (
  env             TEXT        PRIMARY KEY CHECK (env IN ('real', 'paper')),
  appkey_enc      JSONB       NOT NULL,
  appsecret_enc   JSONB       NOT NULL,
  account_no_enc  JSONB,
  -- 화면에 그릴 가린 계좌번호. 복호화 없이 「어느 계좌인가」를 말할 수 있어야 한다
  account_mask    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.trading_broker_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_broker_credentials FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_broker_credentials FROM PUBLIC;
REVOKE ALL ON public.trading_broker_credentials FROM anon;
REVOKE ALL ON public.trading_broker_credentials FROM authenticated;
GRANT  ALL ON public.trading_broker_credentials TO service_role;

COMMENT ON TABLE public.trading_broker_credentials IS
  'KIS 조회 전용 앱키. 값은 AES-256-GCM 봉투로만 들어가고 복호화는 서버 모듈에서만 한다';

-- ── 상품 규격 초기값 ───────────────────────────────────────
-- 거래소 고시 규격이다(§20). 여기 넣어 두는 이유는 금액 계산이 코드가 아니라
-- 데이터를 읽게 하기 위해서다(M6). 승수가 바뀌면 이 두 줄만 고친다.
INSERT INTO public.trading_instruments (root, multiplier, tick_size, tick_value, active)
VALUES
  ('KOSPI200',      250000, 0.05, 12500, true),
  ('MINI_KOSPI200',  50000, 0.02,  1000, true)
ON CONFLICT (root) DO NOTHING;
