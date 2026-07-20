// 부서 취합 현황 순수 코어(무-import — node:test 로드 가능). DB/클라 의존 없음.

export type DeptAggState = 'none' | 'draft' | 'confirmed'

export interface DeptAggStat {
  id: string
  name: string
  memberCount: number
  reportedCount: number
  agg: DeptAggState
}

export interface CompanyRollup {
  /** 전 부서 distinct 멤버 수(중첩 부서 중복 제거). */
  totalMembers: number
  /** 제출한 distinct 멤버 수. */
  reportedMembers: number
  confirmedDepts: number
  totalDepts: number
}

/** 회사 전체 롤업 — 멤버는 부서 간 중복(중첩)이 있으므로 distinct 집합으로 계산(합산 금지). */
export function buildCompanyRollup(
  membersByDept: Record<string, string[]>,
  reporters: ReadonlySet<string>,
  stats: { agg: DeptAggState }[],
): CompanyRollup {
  const all = new Set<string>()
  for (const arr of Object.values(membersByDept)) arr.forEach((m) => all.add(m))
  let reported = 0
  all.forEach((m) => { if (reporters.has(m)) reported += 1 })
  return {
    totalMembers: all.size,
    reportedMembers: reported,
    confirmedDepts: stats.filter((s) => s.agg === 'confirmed').length,
    totalDepts: stats.length,
  }
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
