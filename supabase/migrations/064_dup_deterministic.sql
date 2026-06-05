-- 064: dup_suspects ids 결정적 정렬 (DC-REV M) — "1건만 남기기"가 어느 건을 보존할지 결정적 보장.
-- 신뢰도 높은 건을 첫 번째(보존 대상)로. DRIFT_GUARD: 밴드 정의는 060/061만 — 본 파일은 밴드 무관.
CREATE OR REPLACE FUNCTION public.get_dup_suspects()
RETURNS TABLE(product_hint text, overall_confidence int, dup_count bigint, ids uuid[])
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT product_hint, overall_confidence, count(*) dup_count,
    array_agg(id ORDER BY overall_confidence DESC NULLS LAST, created_at ASC) ids
  FROM review_items
  WHERE status='pending' AND is_test=false AND product_hint IS NOT NULL
  GROUP BY product_hint, overall_confidence
  HAVING count(*) > 1
  ORDER BY count(*) DESC
  LIMIT 100;
$$;
REVOKE EXECUTE ON FUNCTION public.get_dup_suspects() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_dup_suspects() TO service_role;
