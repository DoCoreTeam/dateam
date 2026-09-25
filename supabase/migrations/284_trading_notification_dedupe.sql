-- 284 알림 대기 표에 「같은 알림인가」를 가르는 키를 둔다
--
-- 왜: 282 의 유일 키가 `(signal_id, kind)` 인데 손절 확인·증거금 경고 같은 알림에는
-- 신호가 없다. Postgres 에서 NULL 은 서로 다르므로 `signal_id` 가 비면 유일 키가
-- **아무것도 안 막는다** — 매분 도는 크론이 같은 경고를 하루 390번 넣는다.
-- 그래서 「무엇을 하나로 볼 것인가」를 문자열 한 칸으로 만들고 거기에 유일 키를 건다.
--
-- 신호 알림은 `<신호 ID>:<종류>`, 신호 없는 알림은 `<종목>:<종류>:<거래일>` 처럼 부르는 쪽이 정한다.

ALTER TABLE public.trading_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- 기존 행에 값을 채운다 (지금은 0행이지만 다시 적용해도 안전하게)
UPDATE public.trading_notifications
   SET dedupe_key = signal_id::text || ':' || kind
 WHERE dedupe_key IS NULL AND signal_id IS NOT NULL;

DELETE FROM public.trading_notifications WHERE dedupe_key IS NULL;

ALTER TABLE public.trading_notifications
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trading_notifications_dedupe
  ON public.trading_notifications (dedupe_key);

COMMENT ON COLUMN public.trading_notifications.dedupe_key IS
  '같은 알림인가를 가르는 키. 신호 알림은 <신호 ID>:<종류>, 신호 없는 알림은 부르는 쪽이 정한다 — NULL signal_id 는 유일 키가 안 막는다';

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trading_notifications'::regclass) THEN
    RAISE EXCEPTION 'trading_notifications 의 RLS 가 꺼져 있다';
  END IF;
END $$;
