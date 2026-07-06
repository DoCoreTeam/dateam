-- 144_weekly_report_snapshots.sql
-- 주간보고 "작성분 영구 유실 0" 안전망 — 저장/삭제 직전 전체 확정본 스냅샷(append-only) + 사용자 복원.
--
-- 배경(포렌식): replace_weekly_report = (user,week) 전체 DELETE+INSERT라, 부분 행만 담긴 저장이
--   나머지를 무경고 소실시킴(이도현 06-29 사고). 마이그141이 감사로깅·department_id까지 회귀시켜
--   파괴적 저장이 무기록. 본 마이그는 (a)저장·삭제 직전 전체 스냅샷 (b)감사로깅+dept+content_hash 복원.
-- 무손상: 신규 테이블 추가 + CREATE OR REPLACE + append-only INSERT만. 기존 행 갱신/삭제 없음.
-- 마이그143(work activity_log, 타 세션)과 도메인·번호 비충돌.

-- ── 1. 스냅샷 테이블 (append-only 불변) ──
CREATE TABLE IF NOT EXISTS weekly_report_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start    DATE        NOT NULL,
  department_id UUID        REFERENCES org_nodes(id),
  rows_json     JSONB       NOT NULL,          -- 그 순간 확정본 전체 [{category,performance,plan,issues,seq}]
  row_count     INT         NOT NULL DEFAULT 0,
  reason        TEXT        NOT NULL DEFAULT 'manual_save'
                            CHECK (reason IN ('manual_save','restore','delete_all','delete_row','pre_deploy_seed')),
  actor_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- UTC 저장, 표시 시 KST 변환
);

CREATE INDEX IF NOT EXISTS idx_wrs_user_week ON weekly_report_snapshots (user_id, week_start, taken_at DESC);

ALTER TABLE weekly_report_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 스냅샷만. INSERT: 행위자 본인 명의로만. UPDATE/DELETE 정책 없음 = 불변(복구 무결성).
DROP POLICY IF EXISTS wrs_select ON weekly_report_snapshots;
CREATE POLICY wrs_select ON weekly_report_snapshots
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS wrs_insert ON weekly_report_snapshots;
CREATE POLICY wrs_insert ON weekly_report_snapshots
  FOR INSERT TO authenticated WITH CHECK (actor_id = (select auth.uid()));

-- ── 2. snapshot_weekly_report(week, reason): 현재 확정본 전체를 스냅샷 1건으로 적재 (SSOT) ──
-- replace_weekly_report(저장) + 삭제 액션이 공통 호출. security invoker → 호출자=본인 컨텍스트.
CREATE OR REPLACE FUNCTION snapshot_weekly_report(p_week_start DATE, p_reason TEXT DEFAULT 'manual_save')
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_dept UUID;
  v_rows JSONB;
  v_cnt  INT;
BEGIN
  SELECT department_id INTO v_dept FROM v_user_departments WHERE user_id = auth.uid() LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category', category, 'performance', performance,
           'plan', plan, 'issues', issues, 'seq', seq) ORDER BY category, seq), '[]'::jsonb),
         count(*)
    INTO v_rows, v_cnt
    FROM weekly_reports
    WHERE user_id = auth.uid() AND week_start = p_week_start AND deleted_at IS NULL;

  INSERT INTO weekly_report_snapshots (user_id, week_start, department_id, rows_json, row_count, reason, actor_id)
  VALUES (auth.uid(), p_week_start, v_dept, v_rows, v_cnt, p_reason, auth.uid());
END; $$;

GRANT EXECUTE ON FUNCTION snapshot_weekly_report(DATE, TEXT) TO authenticated;

-- ── 3. replace_weekly_report 재정의 = 스냅샷(선행) + seq(141) + 감사로깅·dept·content_hash(120 복원) ──
-- 시그니처(date,jsonb) 유지 → CREATE OR REPLACE로 기존 GRANT 보존, 오버로드 없음.
CREATE OR REPLACE FUNCTION replace_weekly_report(p_week_start DATE, p_rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_dept    UUID;
  v_existed BOOLEAN;
BEGIN
  SELECT department_id INTO v_dept FROM v_user_departments WHERE user_id = auth.uid() LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM weekly_reports
    WHERE user_id = auth.uid() AND week_start = p_week_start
  ) INTO v_existed;

  -- (A) 유실 0 보루: DELETE 직전 현재 확정본 전체를 스냅샷 (동일 트랜잭션 → "스냅샷 없이 삭제" 불가)
  PERFORM snapshot_weekly_report(p_week_start, 'manual_save');

  -- (B) 파괴적 교체 (기존 동작 유지, 단 스냅샷이 선행됨)
  DELETE FROM weekly_reports
  WHERE user_id = auth.uid() AND week_start = p_week_start;

  INSERT INTO weekly_reports (user_id, week_start, category, performance, plan, issues, department_id, seq, deleted_at)
  SELECT auth.uid(), p_week_start,
         (elem->>'category')::text, (elem->>'performance')::text,
         (elem->>'plan')::text, (elem->>'issues')::text,
         v_dept, (ord - 1)::int, NULL
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ord);

  -- (C) 감사로깅 복원(120) + content_hash: 파괴적 저장을 다시 추적 가능하게
  INSERT INTO weekly_report_activity (user_id, week_start, department_id, action, actor_id, content_hash)
  VALUES (auth.uid(), p_week_start, v_dept,
          CASE WHEN v_existed THEN 'edit' ELSE 'create' END, auth.uid(), md5(p_rows::text));
END; $$;

-- ── 4. 배포 즉시 안전조치: 현재 활성 확정본 전량을 스냅샷 1건씩 시딩(무손상, 추가만) ──
-- 이도현 06-29 5개 포함 전 사용자 현재본 확보 → 배포 순간부터 복원 가능.
INSERT INTO weekly_report_snapshots (user_id, week_start, department_id, rows_json, row_count, reason, actor_id)
SELECT wr.user_id, wr.week_start, (array_agg(wr.department_id))[1],
       jsonb_agg(jsonb_build_object('category', wr.category, 'performance', wr.performance,
         'plan', wr.plan, 'issues', wr.issues, 'seq', wr.seq) ORDER BY wr.category, wr.seq),
       count(*), 'pre_deploy_seed', wr.user_id
FROM weekly_reports wr
WHERE wr.deleted_at IS NULL
GROUP BY wr.user_id, wr.week_start;
