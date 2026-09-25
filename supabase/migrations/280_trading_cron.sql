-- 280: AI 트레이딩 1분 크론 (배포 시 활성화 — 가드)
--
-- 왜 pg_cron 인가 (명세 §4 · D-39)
--   판단 봉이 1분이라 **언제 실행되는가**가 성과를 가른다. Vercel Cron 은 지정한 분 안의
--   아무 시점(최대 약 59초 지연)에 돌고 재시도가 없다. 봉이 끝나고 59초 뒤에 도는 날에는
--   그 분의 판단이 통째로 늦는다.
--   이미 쓰고 있는 pg_cron 은 초 단위로 못 잡지만 실행 시점이 훨씬 고르다.
--   그래서 이 모듈만 예외로 pg_cron 을 기본 스케줄러로 쓰고, Vercel Cron 은 대체로 둔다.
--
-- 표를 만들지 않는다
--   이 판은 **일정만 건다.** 표가 없으니 RLS 를 켤 대상도 없다(LOOP.md 7절 S1 해당 없음).
--
-- 비밀값을 SQL 에 안 적는다 (S3)
--   `cron.job.command` 는 표에 그대로 남는다. 그래서 명령 문자열에 URL 과 토큰을 **전개하지 않고**,
--   실행 시점에 `current_setting()` 으로 읽게 한다 — 107 이 같은 이유로 같은 모양을 쓴다.
--
-- ⚠️ 전제
--   - pg_cron / pg_net 확장이 켜져 있어야 한다(Supabase 대시보드 > Database > Extensions).
--   - pg_net 이 DB → 앱 주소로 닿아야 한다(배포 환경 전제, dev localhost 불가).
--
-- 배포 활성화 절차 (이 둘이 있어야 등록된다):
--   ALTER DATABASE postgres SET app.trading_tick_url    = 'https://<배포도메인>/api/trading/cron/tick';
--   ALTER DATABASE postgres SET app.trading_tick_secret = '<CRON_SECRET 과 동일>';
--   -- 설정은 같은 세션에 즉시 반영되지 않으므로 새 세션에서 이 마이그레이션을 다시 돌린다.
--
-- 되돌리기:
--   SELECT cron.unschedule('trading-tick');

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_url    text := current_setting('app.trading_tick_url', true);
  v_secret text := current_setting('app.trading_tick_secret', true);
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'trading-tick 미등록: app.trading_tick_url / app.trading_tick_secret 설정 후 재실행하세요.';
    RETURN;
  END IF;

  -- 멱등. unschedule 은 잡이 없으면 오류라 존재 확인 후 부른다
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trading-tick') THEN
    PERFORM cron.unschedule('trading-tick');
  END IF;

  -- 매 1분. 라우트가 「지금 할 일」을 스스로 판단하고, 중복은 유일 키와 선점이 막는다(§14.3).
  -- 중첩 dollar-quote: DO 블록은 $$, cron 명령은 $cron$ 로 태그를 나눈다.
  PERFORM cron.schedule(
    'trading-tick',
    '* * * * *',
    $cron$select net.http_post(
      url := current_setting('app.trading_tick_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.trading_tick_secret')
      ),
      body := '{}'::jsonb
    );$cron$
  );

  RAISE NOTICE 'trading-tick 등록 완료: 매 1분 % 호출', v_url;
END;
$$;
