-- 062: 데이터 품질 진단 함수 GRANT 축소 (DC-REV M-1) — SECURITY DEFINER가 RLS 우회하므로
-- authenticated 전체 노출 차단, API(service_role)만 호출. 관리자 진단 데이터(이상치·중복) 보호.
REVOKE EXECUTE ON FUNCTION public.get_anomaly_quotes() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dup_suspects() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_data_quality_metrics() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_anomaly_quotes() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dup_suspects() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_data_quality_metrics() TO service_role;
