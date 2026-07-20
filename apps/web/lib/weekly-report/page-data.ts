// 주간보고 페이지 순수 데이터 변환(테스트 대상) — 팀 행 매핑·내보고 히스토리 그룹핑. DB 무관.

export interface TeamRawRow {
  user_id: string
  category: string
  performance: string
  plan: string
  issues: string
  week_start: string
  profiles?: { name?: string; role?: string } | null
}

export interface TeamMemberReport {
  userId: string
  userName: string
  role: string
  category: string
  performance: string
  plan: string
  issues: string
  weekStart: string
}

/** 팀 원본 행 → 뷰 모델. admin(본부장)을 항상 최상위로 정렬. */
export function mapTeamReports(rows: TeamRawRow[] | null): TeamMemberReport[] {
  return (rows ?? [])
    .map((r) => ({
      userId: r.user_id,
      userName: r.profiles?.name ?? '알 수 없음',
      role: r.profiles?.role ?? 'member',
      category: r.category,
      performance: r.performance,
      plan: r.plan,
      issues: r.issues,
      weekStart: r.week_start,
    }))
    .sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1))
}

/** 내 보고 히스토리 그룹핑(이번주 제외) — {weekStart, reports}[]. */
export function buildHistoryGroups<T extends { week_start: string }>(
  reports: T[] | null,
  thisWeek: string,
): { weekStart: string; reports: T[] }[] {
  const grouped = (reports ?? []).reduce<Record<string, T[]>>((acc, r) => {
    if (!acc[r.week_start]) acc[r.week_start] = []
    acc[r.week_start].push(r)
    return acc
  }, {})
  return Object.entries(grouped)
    .filter(([weekStart]) => weekStart !== thisWeek)
    .map(([weekStart, reps]) => ({ weekStart, reports: reps }))
}
