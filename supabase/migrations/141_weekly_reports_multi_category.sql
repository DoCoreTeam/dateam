-- 141_weekly_reports_multi_category.sql
-- B-1: 주간보고 "같은 카테고리 다중 기록" 허용 + 무경고 유실버그 근본 수정
--
-- 문제: UNIQUE(user_id, week_start, category)가 카테고리당 1행을 강제해,
--   폼에서 같은 구분(category)으로 여러 행을 작성해도 저장 시 마지막 행만 남고
--   앞 행들이 조용히 사라짐(actions.ts의 Map dedup + DB UNIQUE 이중 강제).
-- 해결: seq 컬럼으로 같은 카테고리 내 순서를 구분하고, UNIQUE를 (…, category, seq)로 완화.
--   replace_weekly_report RPC는 full DELETE+INSERT라 seq는 배열 순서(ordinality-1)로 안전 부여.
--
-- 롤백 안전: 기존 행은 seq=0 백필(구 UNIQUE가 카테고리 유일성 보장했으므로 충돌 없음).

ALTER TABLE weekly_reports
  ADD COLUMN IF NOT EXISTS seq INT NOT NULL DEFAULT 0;

ALTER TABLE weekly_reports
  DROP CONSTRAINT IF EXISTS uq_weekly_reports_user_week_category;

ALTER TABLE weekly_reports
  ADD CONSTRAINT uq_weekly_reports_user_week_category_seq
    UNIQUE (user_id, week_start, category, seq);

-- RPC 갱신: seq를 배열 전역 순서(ord-1)로 부여 → (category, seq) 유일성 항상 성립.
CREATE OR REPLACE FUNCTION replace_weekly_report(
  p_week_start DATE,
  p_rows       JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  DELETE FROM weekly_reports
  WHERE user_id = auth.uid()
    AND week_start = p_week_start;

  INSERT INTO weekly_reports (user_id, week_start, category, performance, plan, issues, seq, deleted_at)
  SELECT
    auth.uid(),
    p_week_start,
    (elem->>'category')::text,
    (elem->>'performance')::text,
    (elem->>'plan')::text,
    (elem->>'issues')::text,
    (ord - 1)::int,
    NULL
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ord);
END;
$$;
