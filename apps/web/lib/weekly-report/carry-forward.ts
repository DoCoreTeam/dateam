// 주간보고 이월(carry-forward) 순수 로직 SSOT — 테스트 대상.
// 전주(편집 주의 직전 주) 계획 → 이번 편집 주의 "빈 성과"로 이월.
// 사용자가 이미 작성한 성과는 절대 덮어쓰지 않는다. 프리필 전용(저장 전까지 DB 미반영).

export interface CarryRow {
  category: string
  performance: string
  plan: string
  issues: string
}

/** 리치텍스트가 실질 비어있지 않은지(빈 <p></p> 등 제외). */
export function isNonEmptyRich(s: string): boolean {
  return !!s && s !== '<p></p>' && s !== '<p><br></p>' && s.trim() !== ''
}

/**
 * 직전 주 계획 맵(카테고리 → 최초로 비어있지 않은 계획).
 * @param reports 사용자의 전체 주간보고 행(주차 무관 — 내부에서 prevWeek로 필터).
 * @param prevWeek 편집 주의 직전 주(week_start 'YYYY-MM-DD').
 */
export function buildPrevPlanMap(
  reports: { week_start: string; category: string; plan: string }[],
  prevWeek: string,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of reports) {
    if (r.week_start === prevWeek && isNonEmptyRich(r.plan) && !m.has(r.category)) {
      m.set(r.category, r.plan)
    }
  }
  return m
}

/**
 * 이월 병합. 빈 성과 셀만 전주 계획으로 채우고, 전주에만 있던 구분은 이월 행으로 추가.
 * @returns rows=병합된 프리필, carriedCount=이월된 셀/행 수(>0이면 안내 배너 노출).
 */
export function computeCarryForward(
  prefillRows: CarryRow[],
  prevPlanByCategory: Map<string, string>,
): { rows: CarryRow[]; carriedCount: number } {
  let carriedCount = 0
  // 1) 기존 프리필 행의 "빈 성과"만 전주 계획으로 채움(작성분 미덮어씀).
  const merged: CarryRow[] = prefillRows.map((row) => {
    const prevPlan = prevPlanByCategory.get(row.category)
    if (prevPlan && !isNonEmptyRich(row.performance)) {
      carriedCount++
      return { ...row, performance: prevPlan }
    }
    return row
  })
  // 2) 전주에만 있던 구분(계획 존재) → 이번 주 이월 행으로 추가.
  const existingCats = new Set(prefillRows.map((r) => r.category))
  prevPlanByCategory.forEach((plan, cat) => {
    if (!existingCats.has(cat)) {
      merged.push({ category: cat, performance: plan, plan: '', issues: '' })
      carriedCount++
    }
  })
  return { rows: merged, carriedCount }
}
