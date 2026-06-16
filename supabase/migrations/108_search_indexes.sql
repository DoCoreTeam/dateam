-- =============================================================================
-- 108_search_indexes.sql
-- newAX Platform — 통합검색용 인덱스
-- =============================================================================
-- 목적: 통합검색에서 키워드 ilike 검색을 가속한다.
--       일일 업무 / 부서 업무는 동일 테이블(daily_logs)이므로 content·original_input에
--       trigram GIN 인덱스를 추가해 부분일치(`%키워드%`) 검색의 seq scan을 제거한다.
--
-- 변경 내역:
--   1. daily_logs.content        — trigram GIN (일일·부서업무 본문 키워드 검색)
--   2. daily_logs.original_input — trigram GIN (AI 추출 전 원문 검색, nullable 허용)
--   3. weekly_reports.category   — trigram GIN (분류 키워드 검색)
--
-- 주의:
--   - pg_trgm 확장은 mig101에서 이미 설치됨. 멱등성 위해 IF NOT EXISTS 재선언.
--   - 모든 인덱스에 IF NOT EXISTS 적용 (중복 실행 안전).
--   - CONCURRENTLY 미사용 (migrate.sh는 트랜잭션 내 실행 — CONCURRENTLY와 충돌).
--   - weekly_reports.performance/plan/issues는 HTML(Tiptap)이라 trgm 직접 인덱스
--     효용이 낮아 생략. BE에서 htmlToPlain 변환 후 ilike로 검색하며, 주간보고
--     볼륨이 작아 seq scan 허용. 추후 plain 미러 컬럼 + trgm 인덱스 도입 고려.
--
-- 롤백:
--   DROP INDEX IF EXISTS idx_daily_logs_content_trgm;
--   DROP INDEX IF EXISTS idx_daily_logs_original_input_trgm;
--   DROP INDEX IF EXISTS idx_weekly_reports_category_trgm;
-- =============================================================================

-- 0) 퍼지매칭(trigram) 확장 — mig101에서 설치됨, 멱등 재선언
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) 일일·부서업무 본문 키워드 검색 가속
CREATE INDEX IF NOT EXISTS idx_daily_logs_content_trgm
  ON daily_logs USING gin (content gin_trgm_ops);

-- 2) AI 추출 전 원문 검색 가속 (nullable — NULL 행은 인덱스에 미포함, 정상)
CREATE INDEX IF NOT EXISTS idx_daily_logs_original_input_trgm
  ON daily_logs USING gin (original_input gin_trgm_ops);

-- 3) 주간보고 분류(category) 키워드 검색 가속
CREATE INDEX IF NOT EXISTS idx_weekly_reports_category_trgm
  ON weekly_reports USING gin (category gin_trgm_ops);
