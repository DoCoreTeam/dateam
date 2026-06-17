-- 113_onboarding.sql
-- 실습형 인터랙티브 온보딩 (v0.7.185)
-- ADD-only · 롤백 가능 · 기존 행 보호.
--
-- 1) profiles: 온보딩 진행/완료/스킵 상태 (must_change_password 패턴 복제, NULL=미완료)
-- 2) daily_logs: is_onboarding 플래그 — 온보딩 실습으로 만든 행을 격리
--    (개인 일일업무 task_kind='personal' / 부서업무 task_kind='dept_task' 모두 daily_logs에 존재).
--    롤업/AI 후보추출/주간보고 집계에서 제외하는 데 사용.
-- 3) 기존 member 백필: 이미 가입한 사용자는 온보딩을 본 적 없으므로 갑작스런 노출 방지를 위해
--    onboarding_completed_at = now() 로 완료 처리. 신규 가입자만 NULL(기본값)→온보딩 노출.

-- ── 1. profiles 온보딩 상태 컬럼 ──
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,   -- NULL = 미완료
  ADD COLUMN IF NOT EXISTS onboarding_step         TEXT,          -- 마지막 도달 스텝 key (재개용)
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at   TIMESTAMPTZ;   -- 스킵 시각(완료와 구분)

-- ── 2. daily_logs 온보딩 실습 격리 플래그 ──
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS is_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

-- 격리 행을 빠르게 제외하기 위한 부분 인덱스(운영 행만 인덱싱)
CREATE INDEX IF NOT EXISTS daily_logs_not_onboarding
  ON daily_logs (user_id, log_date DESC)
  WHERE is_onboarding = FALSE;

-- ── 3. 기존 사용자 백필 (D-2: 기존 member 미노출) ──
-- 이미 존재하는 모든 프로필은 완료 처리하여 온보딩 자동노출 대상에서 제외.
-- 신규 가입자(이 마이그레이션 이후 생성)는 컬럼 기본값 NULL → 온보딩 노출.
UPDATE profiles
   SET onboarding_completed_at = now()
 WHERE onboarding_completed_at IS NULL;
