-- 145_replace_weekly_report_grant.sql
-- 보안 하드닝: replace_weekly_report(date, jsonb) 실행 권한을 최소화.
-- 왜: Postgres 함수는 기본 PUBLIC 실행 가능(033부터의 기존 gap). SECURITY INVOKER라 RLS로
--   데이터는 보호되지만, 실행권한 자체는 익명(anon)에게도 열려 있었다. 인증 사용자로 좁힌다.
-- 안전성: 실제 호출처는 모두 사용자 세션(authenticated) — upsertWeeklyReport / draft PUT / 스냅샷 복원.
--   service_role도 함께 GRANT(관리/배치 경로 대비, 현재 미사용이나 보수적으로 유지).
-- 비파괴: 데이터 변경 없음, 권한만 조정. 롤백 = GRANT EXECUTE ... TO PUBLIC.

REVOKE ALL ON FUNCTION replace_weekly_report(date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_weekly_report(date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_weekly_report(date, jsonb) TO service_role;
