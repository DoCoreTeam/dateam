-- 110: match_projects IDOR 방어 강화 (DC-SEC SEC-MEDIUM P3 반영)
--  배경: 109의 match_projects는 SECURITY DEFINER(RLS 우회)인데 소유자 필터를 호출자가 넘기는
--        requester_id에만 의존. authenticated 사용자가 타인의 uid를 requester_id로 넘기면
--        그 사용자의 프로젝트(id·name·유사도)를 열람할 수 있는 IDOR 노출 가능성.
--  보수: 본문에서 auth.uid()를 신뢰 기준으로 강제한다.
--        - authenticated 호출: requester_id 무시하고 auth.uid() 소유 행만 반환(파라미터 위조 무력화).
--        - service_role 호출(서버 배치): auth.uid()가 없으므로 requester_id를 신뢰(기존 서버 경로 호환).
--        requester_id 파라미터는 ABI 호환을 위해 유지(호출처 무수정).
--  정합: 102 match_daily_logs(요청자 범위 제한)·101/109 match RPC 패턴과 동형.
--  멱등: CREATE OR REPLACE로 109의 match_projects를 대체. 시그니처·GRANT 동일 유지.

DROP FUNCTION IF EXISTS match_projects(vector, uuid, int, float);
CREATE OR REPLACE FUNCTION match_projects(
  query_embedding vector(768),
  requester_id uuid,
  match_count int,
  min_sim float
)
RETURNS TABLE (id uuid, name text, similarity float)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, 1 - (p.embedding <=> query_embedding)
  FROM projects p
  WHERE p.embedding IS NOT NULL
    AND p.deleted_at IS NULL
    -- 소유자 강제: 로그인 사용자는 auth.uid() 소유 행만(requester_id 위조 차단),
    -- service_role(auth.uid() IS NULL)은 넘어온 requester_id를 신뢰.
    AND p.user_id = COALESCE((SELECT auth.uid()), requester_id)
    AND 1 - (p.embedding <=> query_embedding) > min_sim
  ORDER BY p.embedding <=> query_embedding ASC
  LIMIT least(match_count, 30);
$$;

-- 권한: 109와 동일 — service_role(서버 배치) + authenticated(로그인 사용자) 호출 허용.
GRANT EXECUTE ON FUNCTION match_projects(vector, uuid, int, float) TO service_role, authenticated;
