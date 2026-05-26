-- =============================================================================
-- 014_performance_indexes.sql
-- newAX Platform — DB 성능 최적화 인덱스
-- =============================================================================
-- 목적: RLS 정책 및 집계 쿼리에서 반복적으로 사용되는 필터 조건에 대한
--       누락된 인덱스를 추가하여 쿼리 플래너 성능을 개선한다.
--
-- 변경 내역:
--   1. profiles         — deleted_at IS NULL 부분 인덱스
--   2. ai_token_logs    — (user_id, feature, created_at DESC) 복합 인덱스
--   3. weekly_reports   — deleted_at IS NULL 부분 복합 인덱스
--
-- 주의:
--   - 모든 인덱스에 IF NOT EXISTS 적용 (중복 실행 안전)
--   - CONCURRENTLY 미사용 (Supabase 마이그레이션은 트랜잭션 내 실행)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — deleted_at IS NULL 부분 인덱스
--
-- 문제: 모든 RLS 정책(SELECT/UPDATE)의 서브쿼리가
--       WHERE p.id = auth.uid() AND p.role = 'admin' AND p.deleted_at IS NULL
--       조건을 사용하는데, deleted_at IS NULL 필터에 인덱스가 없음.
-- 효과: 소프트 삭제되지 않은 활성 프로필만 인덱싱하여 RLS 서브쿼리 비용 감소.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_active
  ON profiles(id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. ai_token_logs — 집계 쿼리용 복합 인덱스
--
-- 기존 인덱스: idx_ai_token_logs_user (user_id 단일)
--             idx_ai_token_logs_feature (feature 단일)
--             idx_ai_token_logs_created (created_at DESC 단일)
--             idx_ai_token_logs_month (date_trunc 월별)
--
-- 문제: 사용자별 기능(feature)별 기간 집계 시 기존 단일 인덱스로는
--       멀티컬럼 필터를 커버할 수 없어 Index Scan 후 재필터링 발생.
-- 효과: (user_id, feature, created_at DESC) 복합 인덱스로
--       "특정 사용자의 특정 기능 최근 N건" 쿼리를 Index Only Scan으로 처리.
--
-- 참고: created_at DESC 단일 인덱스(idx_ai_token_logs_created)는
--       전체 최신순 조회용으로 유지.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_user_feature
  ON ai_token_logs(user_id, feature, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. weekly_reports — deleted_at IS NULL 부분 복합 인덱스
--
-- 문제: 기존 idx_weekly_reports_user_week (user_id, week_start) 인덱스는
--       deleted_at 필터를 포함하지 않아, 소프트 삭제 레코드까지 스캔 후
--       애플리케이션 레벨에서 필터링함.
-- 효과: 활성 레코드만 인덱싱하고 created_at DESC를 포함하여
--       "사용자의 최근 보고서 목록" 쿼리 성능 개선.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_weekly_reports_active
  ON weekly_reports(user_id, created_at DESC)
  WHERE deleted_at IS NULL;
