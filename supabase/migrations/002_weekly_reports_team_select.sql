-- 002: 팀원 간 주간보고 상호 조회 허용
-- 기존 정책(본인+admin만 SELECT)을 확장하여 모든 authenticated 멤버가 팀 전체 보고를 열람 가능하게 함

DROP POLICY IF EXISTS weekly_reports_select ON weekly_reports;

CREATE POLICY weekly_reports_select
  ON weekly_reports FOR SELECT
  USING (
    -- 삭제되지 않은 보고만 조회 가능
    deleted_at IS NULL
    -- 모든 로그인 사용자가 팀 전체 보고 열람 가능
    AND auth.uid() IS NOT NULL
  );
