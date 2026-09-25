-- 283 알림 아웃박스에 「마지막으로 보내 본 때」를 더한다
--
-- 왜: 재시도 간격을 두려면 마지막 시도 시각이 있어야 한다. 282 에는 `sent_at` 만 있고
-- 그것은 성공했을 때만 찬다. 실패한 행은 시각이 없어 「방금 실패한 것」과
-- 「30분 전에 실패한 것」이 구별되지 않고, 크론이 매분 돌면 상한 다섯이 5분 만에 소진된다.
-- 잠깐 끊긴 발송이 영구 실패가 되는 길이다.

ALTER TABLE public.trading_notifications
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.trading_notifications.last_attempt_at IS
  '마지막으로 보내 본 때. 성공·실패 모두 찍는다 — 실패한 행의 재시도 간격을 이 값으로 잰다';

-- 282 에서 건 잠금은 그대로다. 칼럼만 더하므로 RLS·권한을 다시 걸 필요가 없지만,
-- 사본이 아닌 원본임을 분명히 하려고 현재 상태를 확인만 한다.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trading_notifications'::regclass) THEN
    RAISE EXCEPTION 'trading_notifications 의 RLS 가 꺼져 있다';
  END IF;
END $$;
