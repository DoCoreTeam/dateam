-- 102: autolink 보안 보강 (DC-SEC H1·H4 반영)
--  H1: match_daily_logs가 service_role 호출 시 RLS 우회 → 타 사용자 업무 노출. 요청자 범위로 제한.
--  H4: autolink_alias 전체공개(USING true) → 거래처/딜/연락처명 조직노출. service_role 전용으로 강등.

-- H1: 요청자 본인(또는 admin) 업무만 후보로. 개인 업무 흐름 연결이 기본 — 교차 노출 차단.
DROP FUNCTION IF EXISTS match_daily_logs(vector, uuid, int, float);
CREATE OR REPLACE FUNCTION match_daily_logs(query_embedding vector(768), exclude_id uuid, requester_id uuid, match_count int, min_sim float)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.content, 1 - (d.embedding <=> query_embedding)
  FROM daily_logs d
  WHERE d.embedding IS NOT NULL AND d.id <> exclude_id
    AND 1 - (d.embedding <=> query_embedding) > min_sim
    AND (
      d.user_id = requester_id
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = requester_id AND p.role = 'admin' AND p.deleted_at IS NULL)
    )
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT least(match_count, 50);
$$;

-- H4: 별칭사전은 서버(service_role)만 — authenticated 공개 SELECT 제거.
DROP POLICY IF EXISTS alias_select ON autolink_alias;
