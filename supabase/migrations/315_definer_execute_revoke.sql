-- 315 SECURITY DEFINER 함수 실행 권한 회수
--
-- 왜: 함수를 만들면 Postgres 는 PUBLIC 에 실행 권한을 준다. SECURITY DEFINER 는 RLS 를 건너뛰므로
--   로그인하지 않은 사람(anon)도 익명 키로 /rest/v1/rpc 를 불러 표를 직접 만질 수 있었다(감사 2026-10-23).
--   보안 기계 셈은 search_path 가 박혔는지만 보므로 이 구멍을 못 셌다.
--   - rfp_enqueue_job: 아무 조직에나 분석 작업을 넣는다 (기본 조직 번호는 고정값)
--   - rfp_claim_jobs, rfp_finish_job, rfp_fail_job, rfp_reap_stale_jobs: 대기 작업을 가로채거나 끝내 버린다
--   - crm_claim_finish_jobs, crm_expire_finish_jobs: 회의 마무리 작업을 가로채거나 만료시킨다
--   - get_schema_digest: 표와 칸 전체 지도를 익명에게 준다
--   - match_projects: auth.uid() 가 없으면 넘어온 requester_id 를 믿으므로, 익명은 남의 id 로 그 사람의 프로젝트 이름을 읽는다
--
-- 앱이 부르는 자리: 작업 함수와 스키마 함수는 서비스롤(createAdminClient)로만 부른다.
--   rfp_enqueue_job 만 로그인한 사용자의 클라이언트로 부르므로(api/rfp/cases/[id]/analyze, cross)
--   authenticated 는 남기고, 함수 안에서 그 조직에 쓸 수 있는지(rfp_can_write) 본다.
--
-- 되돌리기: GRANT EXECUTE ON FUNCTION <이름>(<인자>) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.rfp_claim_jobs(text, int, int, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfp_finish_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfp_fail_job(uuid, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfp_reap_stale_jobs(interval, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_claim_finish_jobs(int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_expire_finish_jobs(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_schema_digest() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_projects(vector, uuid, int, float) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rfp_claim_jobs(text, int, int, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.rfp_finish_job(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rfp_fail_job(uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.rfp_reap_stale_jobs(interval, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_claim_finish_jobs(int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_expire_finish_jobs(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_schema_digest() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_projects(vector, uuid, int, float) TO service_role, authenticated;

-- 로그인한 사람이 부를 때는 그 조직에 쓸 수 있어야 한다. 중복 확인도 같은 조직 안에서만 한다
-- (예전에는 남의 조직 작업도 dedupe_key 만 맞으면 되돌려 받았다)
CREATE OR REPLACE FUNCTION public.rfp_enqueue_job(
  p_org_id     uuid,
  p_case_id    uuid,
  p_job_type   text,
  p_payload    jsonb default '{}',
  p_priority   int default 5,
  p_dedupe_key text default null
)
RETURNS rfp_analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare r rfp_analysis_jobs;
begin
  if auth.uid() is not null and not rfp_can_write(p_org_id) then
    raise exception 'rfp_enqueue_job: 이 조직에 작업을 넣을 권한이 없습니다' using errcode = '42501';
  end if;

  if p_dedupe_key is not null then
    select * into r from rfp_analysis_jobs
     where org_id = p_org_id and dedupe_key = p_dedupe_key and status in ('queued','running')
     limit 1;
    if found then return r; end if;
  end if;

  insert into rfp_analysis_jobs (org_id, case_id, job_type, payload, priority, dedupe_key)
  values (p_org_id, p_case_id, p_job_type, coalesce(p_payload, '{}'::jsonb), p_priority, p_dedupe_key)
  returning * into r;
  return r;
end $$;

REVOKE ALL ON FUNCTION public.rfp_enqueue_job(uuid, uuid, text, jsonb, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rfp_enqueue_job(uuid, uuid, text, jsonb, int, text) TO authenticated, service_role;
