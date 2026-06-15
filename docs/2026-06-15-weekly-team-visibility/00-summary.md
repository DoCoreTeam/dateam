# 주간보고 "팀 전체" = 소속 부서 전원 가시화 (RLS 보완)

## 증상
member(팀원) 계정에서 주간보고 "팀 전체"에 **같은 팀(소속 부서) 동료 보고가 안 보임** — 본인 것만 표시.

## 근본 원인 (라이브 검증)
- `weekly_report_hierarchy_enabled = true`(074) + `050` 격리 정책.
- `050`의 `weekly_reports_select`는 `user_id=본인 OR department_id=ANY(my_managed_dept_ids()) OR is_executive()`.
- `my_managed_dept_ids()` = **내가 head인 서브트리(소속 부서 제외)**. 평팀원은 head가 아니라 **빈 배열** → 본인만 보임.

## 기획 확정 (사용자)
- **팀 전체 = 조직도 기준 '같은 소속 부서' 전원** (하위 서브트리는 제외 — 그건 "조직현황").
- 하위 부서 내용은 **해당 부서 조직장 + 상위 부서 조직장**이 봄 → 현행 `my_managed_dept_ids()`(head 서브트리)가 이미 담당. 유지.

## 변경 (가산적·데이터 무변경)
`supabase/migrations/098_weekly_report_team_visibility.sql`
- 신규 `private.my_team_dept_ids()` = `v_user_departments`(person노드 parent dept) 기준 **본인 소속 부서만**(서브트리 아님).
- `weekly_reports_select` 정책에 `OR department_id = ANY(private.my_team_dept_ids())` 추가.
- 기존 분기(본인/관리 서브트리/임원/플래그OFF) 전부 유지. INSERT/UPDATE/DELETE·daily_logs 정책 무변경.

## 검증
- RLS 시뮬(평팀원 가장): 같은 부서 3명 전원 보임(`distinct_authors=3`), **타 부서 누출 0**(`distinct_depts_visible=1`).
- `weekly_reports.department_id` = 작성자 소속 부서와 일치(샘플 전부 match) 확인.
- 🟥 DC-SEC PASS(BLOCK 0) · 🟥 DC-REV APPROVED 89/100.
- UI(`api/weekly-report/team/route.ts`)는 부서필터 없이 RLS 의존 → RLS 완화만으로 표시됨(코드 무변경).

## 영향
- 같은 소속 부서 팀원끼리 주간보고 상호 열람 가능(팀 전체). 타 부서·하위 서브트리 비노출(조직장/임원 경로는 별개 유지).

## 후속 권고(비차단)
- `v_user_departments` 조회 성능: `org_nodes(user_id)` 인덱스 확인(현 규모 20명 무영향).
- 필요 시 롤백용 reverse migration 준비.
