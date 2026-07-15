-- 160_market_refresh_runs.sql
-- 목적: 경쟁사 가격 "자동 수집"을 하루 1회만 돌리기 위한 실행 기록(멱등 키).
--   (설계 헌법 제10조 가격 수집 자동화 — 크론 대신 "그날 첫 접속자가 1회 구동")
--
-- 동작: run_date(KST 날짜)를 기본키로 두어, 그날 한 번만 INSERT 성공한다.
--   동시에 여러 명이 접속해도 두 번째부터는 기본키 충돌로 자동 스킵(경합 방지).
--   환율 동기화(fx_rates.rate_date)와 동일한 "날짜=멱등키" 패턴.

CREATE TABLE IF NOT EXISTS market_refresh_runs (
  run_date       date PRIMARY KEY,                 -- KST 기준 수집일 (하루 1회 멱등키)
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running',  -- running | done | error
  trigger_source text,                             -- 'first-visit' | 'manual' | 'cron'
  urls_checked   integer,
  prices_updated integer,
  error          text
);

COMMENT ON TABLE market_refresh_runs IS
  '경쟁사 가격 자동 수집의 하루 1회 실행 기록. run_date=KST 날짜를 기본키로 멱등·경합방지. (헌법 제10조)';

-- RLS: 서버(서비스롤)만 쓰고, 관리자만 읽는다(운영 지표용). 일반 접근 차단(default-deny).
ALTER TABLE market_refresh_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_refresh_runs_admin_read ON market_refresh_runs;
CREATE POLICY market_refresh_runs_admin_read ON market_refresh_runs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
-- 쓰기 정책 없음 → 서비스롤(RLS 우회)만 기록. 클라이언트 직접 쓰기 차단.
