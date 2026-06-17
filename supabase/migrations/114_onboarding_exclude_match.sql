-- 114_onboarding_exclude_match.sql
-- 온보딩 실습 행(is_onboarding=true)을 AI 유사도 매칭(autolink/제안 입력)에서 제외.
-- 102_autolink_security.sql 의 match_daily_logs 를 동일 시그니처로 재정의 + WHERE 절에 is_onboarding 필터 추가.
-- 다른 변경 없음(보안/요청자 범위 로직 그대로 유지).

DROP FUNCTION IF EXISTS match_daily_logs(vector, uuid, uuid, int, float);
CREATE OR REPLACE FUNCTION match_daily_logs(query_embedding vector(768), exclude_id uuid, requester_id uuid, match_count int, min_sim float)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.content, 1 - (d.embedding <=> query_embedding)
  FROM daily_logs d
  WHERE d.embedding IS NOT NULL AND d.id <> exclude_id
    AND d.is_onboarding = false            -- 온보딩 실습 행 제외
    AND 1 - (d.embedding <=> query_embedding) > min_sim
    AND (
      d.user_id = requester_id
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = requester_id AND p.role = 'admin' AND p.deleted_at IS NULL)
    )
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT least(match_count, 50);
$$;
