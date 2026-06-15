-- 103: autolink 실행 마커 (DC-REV 성능 — 빈 결과 로그가 패널 열 때마다 재실행되는 비용 차단)
--  autolink_run_at 가 있으면 자동 재실행 건너뜀(사용자 '다시 찾기'는 명시 호출이라 별개).
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS autolink_run_at timestamptz;
