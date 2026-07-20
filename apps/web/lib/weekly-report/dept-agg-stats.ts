// 부서별 주간보고 취합 현황 집계(SSOT) — 어드민 취합 첫화면·조직현황이 공유하는 계산.
// dept_weekly_reports.status(취합) + weekly_reports 제출자 집합 → 부서별 {제출 N/M, 취합상태}.

import { deptMemberUserIds, type OrgScope } from '@/lib/org-scope'
import type { AggState } from '@/app/(member)/weekly-report/DeptReportPanel'

export interface DeptAggStat {
  id: string
  name: string
  memberCount: number
  reportedCount: number
  agg: AggState
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 전 부서 취합 현황 일괄 계산(배치 IN 쿼리 — N+1 없음). */
export async function computeDeptAggStats(
  admin: AdminClient,
  scope: OrgScope,
  deptNodes: { id: string; name: string }[],
  weekStart: string,
): Promise<DeptAggStat[]> {
  const allDeptIds = deptNodes.map((d) => d.id)
  const [{ data: weekReps }, { data: snaps }] = await Promise.all([
    admin.from('weekly_reports').select('user_id').eq('week_start', weekStart).is('deleted_at', null),
    admin.from('dept_weekly_reports').select('department_id, status').eq('week_start', weekStart)
      .in('department_id', allDeptIds.length ? allDeptIds : ['00000000-0000-0000-0000-000000000000']),
  ])
  const reporters = new Set((weekReps ?? []).map((r: { user_id: string }) => r.user_id))
  const statusMap = new Map((snaps ?? []).map((s: { department_id: string; status: AggState }) => [s.department_id, s.status]))
  return deptNodes.map((d) => {
    const members = deptMemberUserIds(scope, d.id)
    return {
      id: d.id,
      name: d.name,
      memberCount: members.length,
      reportedCount: members.filter((m) => reporters.has(m)).length,
      agg: (statusMap.get(d.id) as AggState) ?? 'none',
    }
  })
}
