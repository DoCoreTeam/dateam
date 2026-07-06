-- 147_match_daily_logs_exclude_deleted.sql
-- soft-delete 정합성: pgvector 후보 recall(match_daily_logs)이 삭제된 daily_logs를 추천하지 않도록 제외.
-- 마이그146에서 daily_logs.deleted_at 도입 → autolink 후보에서 삭제행이 새어나오던 갭 봉합.
-- 비파괴: 동일 시그니처 CREATE OR REPLACE, WHERE에 deleted_at IS NULL 한 줄 추가.

CREATE OR REPLACE FUNCTION match_daily_logs(query_embedding vector(768), exclude_id uuid, requester_id uuid, match_count int, min_sim float)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.content, 1 - (d.embedding <=> query_embedding)
  FROM daily_logs d
  WHERE d.embedding IS NOT NULL AND d.id <> exclude_id
    AND d.is_onboarding = false
    AND d.deleted_at IS NULL                -- 삭제(soft) 행 제외 (마이그146)
    AND 1 - (d.embedding <=> query_embedding) > min_sim
    AND (
      d.user_id = requester_id
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = requester_id AND p.role = 'admin' AND p.deleted_at IS NULL)
    )
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT least(match_count, 50);
$$;
