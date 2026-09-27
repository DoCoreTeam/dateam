-- 291_trading_notify_kinds.sql — 목표 도달과 시간 청산을 알린다 (명세 §8 D-32)
--
-- 왜: D-32 는 「가격이 목표·손절에 닿으면 청산하세요 알림을 보낸다」를 **채택**해 두었다.
-- 손절 쪽은 `protection_breached` 로 있었는데 **목표 쪽과 시간 청산이 없었다.**
-- 그래서 목표가에 닿아도 사람에게 아무 말도 안 갔고, 보유 시간이 지나도 마찬가지였다.
--
-- 기존 `exit` 종류는 「오늘 **수익 목표**에 닿았다」라서 뜻이 다르다. 같은 이름으로 묶으면
-- 하루 한 번 오는 말과 포지션마다 오는 말이 한 줄에 섞인다.
--
-- 가격 도달은 **알림일 뿐**이다. 포지션 상태와 실현 손익은 체결을 확인했을 때만 바뀐다(D-32).
--
-- 이 판은 검사 제약만 넓힌다. 표도 정책도 RLS 도 안 건드린다.

ALTER TABLE public.trading_notifications
  DROP CONSTRAINT IF EXISTS trading_notifications_kind_check;

ALTER TABLE public.trading_notifications
  ADD CONSTRAINT trading_notifications_kind_check CHECK (kind IN (
    'signal', 'exit', 'safety', 'daily_limit', 'session_close', 'protection_breached',
    -- 목표가에 닿았다. 하루 한 번 오는 `exit` 와 다른 말이다
    'target_reached',
    -- 보유 시간이 지났다
    'time_exit'
  ));

COMMENT ON COLUMN public.trading_notifications.kind IS
  '알림 종류. `lib/trading/notify/outbox-policy.ts` 의 NOTIFY_KINDS 와 같은 목록이어야 한다';
