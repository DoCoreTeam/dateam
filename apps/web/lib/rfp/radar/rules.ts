/**
 * 레이더 규칙 (설계서 F8)
 *
 * ## 규칙이 DB 에 있는 이유
 *
 * 「무엇을 찾을까」는 사업 방향이 바뀔 때마다 달라진다. 코드에 박으면
 * 영업 담당자가 못 고치고, 못 고치면 레이더가 곧 낡은 키워드만 훑는다.
 */

export interface RadarRule {
  id: string
  name: string
  keywords: string[]
  classifications: string[]
  budgetMin: number | null
  budgetMax: number | null
  agencies: string[]
  enabled: boolean
  lastSweptAt: string | null
}

/** DB 행 → 규칙 */
export function toRadarRule(row: Record<string, unknown>): RadarRule {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    keywords: asStrings(row.keywords),
    classifications: asStrings(row.classifications),
    budgetMin: numOrNull(row.budget_min),
    budgetMax: numOrNull(row.budget_max),
    agencies: asStrings(row.agencies),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    lastSweptAt: row.last_swept_at === null || row.last_swept_at === undefined ? null : String(row.last_swept_at),
  }
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type RuleProblem = 'no_name' | 'no_condition' | 'bad_budget_range'

/**
 * 규칙이 쓸 만한가.
 *
 * 조건이 하나도 없는 규칙은 **모든 공고를 담는다.** 그러면 레이더가 아니라 소음이다.
 */
export function validateRule(rule: Partial<RadarRule>): RuleProblem[] {
  const problems: RuleProblem[] = []
  if (!rule.name?.trim()) problems.push('no_name')

  const hasCondition = (rule.keywords?.length ?? 0) > 0
    || (rule.classifications?.length ?? 0) > 0
    || (rule.agencies?.length ?? 0) > 0
    || rule.budgetMin !== null && rule.budgetMin !== undefined
    || rule.budgetMax !== null && rule.budgetMax !== undefined
  if (!hasCondition) problems.push('no_condition')

  if (rule.budgetMin != null && rule.budgetMax != null && rule.budgetMin > rule.budgetMax) {
    problems.push('bad_budget_range')
  }
  return problems
}
