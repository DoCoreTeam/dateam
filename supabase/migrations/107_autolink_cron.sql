-- 107: autolink 워커 pg_cron 스케줄 (배포시 활성화 — 가드)
--  설계: docs/2026-06-16-v0.7.157-autolink-queue/01-architecture.md
--  매 1분마다 net.http_post 로 워커 라우트(POST /api/work/autolink/worker)를 호출해
--  pending 잡을 비동기 처리한다. URL/시크릿은 하드코딩 금지 → DB 설정값에서 읽는다.
--
--  ⚠️ 전제:
--   - pg_cron / pg_net 확장은 Supabase 대시보드(Database > Extensions)에서
--     활성화가 필요할 수 있다. pooler 마이그레이션으로 CREATE EXTENSION 이 거부되면
--     대시보드에서 켠 뒤 이 마이그레이션을 재실행한다.
--   - pg_net은 DB→앱 URL 도달이 가능해야 한다(배포 환경 전제 — dev localhost 불가).
--
--  배포 활성화 절차 (이 두 설정이 있어야 cron이 등록됨):
--    ALTER DATABASE postgres SET app.autolink_worker_url    = 'https://<배포도메인>/api/work/autolink/worker';
--    ALTER DATABASE postgres SET app.autolink_worker_secret = '<AUTOLINK_CRON_SECRET 와 동일>';
--    -- 위 설정 후 새 세션에서 이 마이그레이션 재실행(또는 아래 DO 블록만 수동 실행).
--    -- (ALTER DATABASE 설정은 같은 세션에 즉시 반영되지 않으므로 재실행이 필요하다.)

-- 1) 확장 (권한 없으면 실패할 수 있음 — 대시보드에서 활성화)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) 설정값이 있을 때만 cron 등록(가드). 없으면 아무것도 안 하고 NOTICE만.
DO $$
DECLARE
  v_url    text := current_setting('app.autolink_worker_url', true);
  v_secret text := current_setting('app.autolink_worker_secret', true);
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'autolink cron 미등록: app.autolink_worker_url / app.autolink_worker_secret 설정 후 재실행하세요.';
    RETURN;
  END IF;

  -- 기존 동일 잡 제거(멱등) — unschedule는 잡명 없으면 에러라 존재 확인 후 호출
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autolink-worker') THEN
    PERFORM cron.unschedule('autolink-worker');
  END IF;

  -- 매 1분: 워커 라우트 호출.
  --  ⚠️ 시크릿 평문 저장 금지(SEC-M2): command 문자열에 URL/secret 값을 박지 않고,
  --  command SQL 자체가 호출 시점(런타임)에 current_setting()으로 읽게 한다.
  --  → cron.job.command 테이블에는 current_setting(...) 호출만 저장되고 secret 값은 저장되지 않음.
  --  (위 v_url/v_secret 는 등록 가드 용도로만 사용 — 값 자체는 command에 전개하지 않음.)
  --  중첩 dollar-quote: DO 블록은 $$, cron command 는 $cron$ 로 태그 분리(충돌 방지).
  PERFORM cron.schedule(
    'autolink-worker',
    '* * * * *',
    $cron$select net.http_post(
      url := current_setting('app.autolink_worker_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.autolink_worker_secret')
      ),
      body := '{}'::jsonb
    );$cron$
  );

  RAISE NOTICE 'autolink cron 등록 완료: 매 1분 % 호출', v_url;
END;
$$;
