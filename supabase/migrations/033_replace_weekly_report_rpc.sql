-- replace_weekly_report: DELETE + INSERT를 단일 트랜잭션으로 묶어 원자성 보장
-- SECURITY INVOKER: 호출자의 RLS(auth.uid() 기반) 그대로 적용됨
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

  INSERT INTO weekly_reports (user_id, week_start, category, performance, plan, issues, deleted_at)
  SELECT
    auth.uid(),
    p_week_start,
    (elem->>'category')::text,
    (elem->>'performance')::text,
    (elem->>'plan')::text,
    (elem->>'issues')::text,
    NULL
  FROM jsonb_array_elements(p_rows) AS elem;
END;
$$;
