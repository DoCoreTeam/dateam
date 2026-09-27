-- 290_trading_push.sql — 알림이 실제로 나갈 자리 (설계서 §7 · 명세 §12)
--
-- 왜: 알림 대기 표(`trading_notifications`)는 282 에서 만들었고 정책·재시도·유일 키까지
-- 다 있는데, **보낼 곳이 없었다.** `flushNotifications` 가 행을 `sent` 로 적기만 하고
-- 밖으로 나가는 호출이 0건이었다. 예측을 아무리 잘해도 전달이 안 되면 서비스가 아니다.
--
-- 표 둘을 만든다.
--   ① 구독 — 어느 기기로 보낼 것인가. `endpoint` 가 기기 하나를 가리키는 주소다
--   ② 발송 열쇠 — VAPID 키 한 벌. 공개키는 화면이 쓰고, 비밀키는 서버만 쓴다
--
-- 비밀키는 **평문으로 두지 않는다**(S3). `lib/ci/settings/crypto.ts` 의 AES-256-GCM 봉투를
-- 그대로 쓴다 — KIS 자격증명이 이미 그 봉투를 쓰고 있고, 봉투를 한 벌 더 만들면
-- 마스터 키가 둘이 되어 둘 중 하나만 회전시키는 날이 온다.
--
-- env 를 안 늘린다. 열쇠는 이 표에 있고 화면에서 관리한다(LOOP.md 부록).

-- ── ① 알림을 받을 기기 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_push_subscriptions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 기기 하나를 가리키는 주소. 브라우저가 준다
  endpoint      TEXT        NOT NULL,
  -- 본문을 암호화할 때 쓰는 기기 공개키와 인증 비밀. 브라우저가 준다
  p256dh        TEXT        NOT NULL,
  auth          TEXT        NOT NULL,
  -- 누가 등록했나. 사람이 「내 아이폰이 아직 붙어 있나」를 알아볼 수 있게
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at  TIMESTAMPTZ,
  -- 연속 실패 수. 죽은 기기를 알아보는 값이고, 404·410 이면 줄을 지운다
  failure_count INTEGER     NOT NULL DEFAULT 0,
  last_error    TEXT,
  -- 같은 기기가 두 줄이 되면 알림이 두 번 간다(M9). 주소가 곧 기기다
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_trading_push_subscriptions_user
  ON public.trading_push_subscriptions (user_id);

ALTER TABLE public.trading_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_push_subscriptions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_push_subscriptions FROM PUBLIC;
REVOKE ALL ON public.trading_push_subscriptions FROM anon;
REVOKE ALL ON public.trading_push_subscriptions FROM authenticated;
GRANT  ALL ON public.trading_push_subscriptions TO service_role;

COMMENT ON TABLE public.trading_push_subscriptions IS
  '알림을 받을 기기. 서비스롤로만 닿고, 등록은 소유자 관문을 지난 서버 액션이 한다';
COMMENT ON COLUMN public.trading_push_subscriptions.endpoint IS
  '기기 하나의 주소. 유일 키라 같은 기기가 두 줄이 안 된다(M9)';

-- ── ② 발송 열쇠 (VAPID) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trading_push_keys (
  -- 한 벌만 있으면 된다. 두 벌이 되면 어느 키로 보낸 구독인지 못 가린다
  id            TEXT        PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  -- 공개키는 화면이 그대로 쓴다. 이름 그대로 공개다
  public_key    TEXT        NOT NULL,
  -- 비밀키는 봉투 안에 있다. 평문 칼럼을 두지 않는다(S3)
  private_key_enc JSONB     NOT NULL,
  -- 푸시 서버가 「누가 보냈나」를 묻는 자리. mailto: 주소
  subject       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trading_push_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_push_keys FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_push_keys FROM PUBLIC;
REVOKE ALL ON public.trading_push_keys FROM anon;
REVOKE ALL ON public.trading_push_keys FROM authenticated;
GRANT  ALL ON public.trading_push_keys TO service_role;

COMMENT ON TABLE public.trading_push_keys IS
  '웹 푸시 발송 열쇠 한 벌. 비밀키는 AES-256-GCM 봉투 안에 있고 평문 칼럼이 없다(S3)';
COMMENT ON COLUMN public.trading_push_keys.private_key_enc IS
  'lib/ci/settings/crypto.ts 봉투. env 를 안 늘리려고 표에 둔다';
