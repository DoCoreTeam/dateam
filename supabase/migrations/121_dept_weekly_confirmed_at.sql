-- 121_dept_weekly_confirmed_at.sql
-- 부서 취합 "확정 시각" 기록 — 지연 판정의 취합 기준선(앵커).
-- 왜: dept_weekly_reports.status='confirmed' 만 있고 confirmed_at 이 없어 "취합 시점 이후 수정=지연"을
--     판정할 기준 시각이 없음. (재취합 시 최신값으로 갱신; 캘린더선(토/월)은 코드에서 고정 병행)

alter table dept_weekly_reports
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references profiles(id);

-- 백필: 이미 confirmed 인 행은 updated_at 을 취합 확정 시각의 best-effort 근사로 사용.
update dept_weekly_reports
set confirmed_at = updated_at
where status = 'confirmed' and confirmed_at is null;
