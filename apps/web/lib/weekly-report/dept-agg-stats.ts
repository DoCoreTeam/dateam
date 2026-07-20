// 부서별 주간보고 취합 현황 집계 — 어드민 취합 첫화면·조직현황 공유. 순수 코어는 dept-agg-core(테스트 대상).
// dept_weekly_reports.status(취합) + weekly_reports 제출자 집합 → 부서별 {제출 N/M, 취합상태}.

import { deptMemberUserIds, type OrgScope } from '../org-scope-pure'
import { buildDeptAggStats, buildCompanyRollup, type DeptAggStat, type DeptAggState, type CompanyRollup } from './dept-agg-core'

export type { DeptAggStat, CompanyRollup } from './dept-agg-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 전 부서 취합 현황 일괄 계산(배치 IN 쿼리 — N+1 없음). 순수 집계는 buildDeptAggStats로 위임. */
export async function computeDeptAggStats(
  admin: AdminClient,
  scope: OrgScope,
  deptNodes: { id: string; name: string }[],
  weekStart: string,
): Promise<{ stats: DeptAggStat[]; rollup: CompanyRollup }> {
  const allDeptIds = deptNodes.map((d) => d.id)
  const [{ data: weekReps }, { data: snaps }] = await Promise.all([
    admin.from('weekly_reports').select('user_id').eq('week_start', weekStart).is('deleted_at', null),
    admin.from('dept_weekly_reports').select('department_id, status').eq('week_start', weekStart)
      .in('department_id', allDeptIds.length ? allDeptIds : ['00000000-0000-0000-0000-000000000000']),
  ])
  const reporters = new Set<string>((weekReps ?? []).map((r: { user_id: string }) => r.user_id))
  const membersByDept: Record<string, string[]> = {}
  const statusByDept: Record<string, DeptAggState> = {}
  for (const d of deptNodes) membersByDept[d.id] = deptMemberUserIds(scope, d.id)
  for (const s of (snaps ?? []) as { department_id: string; status: DeptAggState }[]) statusByDept[s.department_id] = s.status
  const stats = buildDeptAggStats(deptNodes, membersByDept, reporters, statusByDept)
  return { stats, rollup: buildCompanyRollup(membersByDept, reporters, stats) }
}
