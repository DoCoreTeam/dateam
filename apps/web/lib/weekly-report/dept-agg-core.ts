// 부서 취합 현황 순수 코어(무-import — node:test 로드 가능). DB/클라 의존 없음.

export type DeptAggState = 'none' | 'draft' | 'confirmed'

export interface DeptAggStat {
  id: string
  name: string
  memberCount: number
  reportedCount: number
  agg: DeptAggState
}

/** 부서별 멤버·제출자·취합상태 → 카드 통계(테스트 대상). */
export function buildDeptAggStats(
  deptNodes: { id: string; name: string }[],
  membersByDept: Record<string, string[]>,
  reporters: ReadonlySet<string>,
  statusByDept: Record<string, DeptAggState>,
): DeptAggStat[] {
  return deptNodes.map((d) => {
    const members = membersByDept[d.id] ?? []
    return {
      id: d.id,
      name: d.name,
      memberCount: members.length,
      reportedCount: members.filter((m) => reporters.has(m)).length,
      agg: statusByDept[d.id] ?? 'none',
    }
  })
}
