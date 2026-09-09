/**
 * 결과 기록 (설계서 3.10.5, F7)
 *
 * ## 정답지가 없으면 학습이 아니다
 *
 * 「축적할수록 정확도가 개선된다」는 **정답 데이터 없이는 거짓**이다.
 * 우리가 참여했는지, 누가 얼마에 따갔는지를 적어 두지 않으면
 * 판정이 맞았는지 영영 모른다.
 *
 * ## 결정과 결과는 다르다
 *
 * 「참여하기로 했다」와 「따냈다」는 다른 사실이다. 시스템의 판정이 맞았는지는
 * **결정과 결과를 함께** 봐야 안다 — 부적합이라 했는데 참여해서 따냈다면 판정이 틀린 것이다.
 */

export type Decision = 'go' | 'partial' | 'no_go' | 'undecided'
export type Result = 'won' | 'lost' | 'cancelled' | 'unknown'

export interface OutcomeRecord {
  caseId: string
  decision: Decision
  decisionReason: string | null
  submitted: boolean | null
  result: Result | null
  awardedTo: string | null
  awardedAmount: number | null
  ourRank: number | null
  source: 'manual' | 'g2b'
}

export type OutcomeProblem = 'unknown_decision' | 'unknown_result' | 'rank_without_submit'

/**
 * 사람이 적은 결과를 검사한다.
 *
 * 안 냈는데 순위가 있는 것은 앞뒤가 안 맞는다 — 받아 두면
 * 나중에 「순위 2위인데 미제출」 같은 행이 통계에 섞인다.
 */
export function validateOutcome(raw: unknown): { record: Partial<OutcomeRecord>; problems: OutcomeProblem[] } {
  const body = (raw ?? {}) as Record<string, unknown>
  const problems: OutcomeProblem[] = []

  const decision = String(body.decision ?? 'undecided')
  if (!['go', 'partial', 'no_go', 'undecided'].includes(decision)) problems.push('unknown_decision')

  const result = body.result === undefined || body.result === null ? null : String(body.result)
  if (result !== null && !['won', 'lost', 'cancelled', 'unknown'].includes(result)) problems.push('unknown_result')

  const submitted = typeof body.submitted === 'boolean' ? body.submitted : null
  const ourRank = Number.isInteger(body.ourRank) ? Number(body.ourRank) : null
  if (ourRank !== null && submitted === false) problems.push('rank_without_submit')

  return {
    record: {
      decision: problems.includes('unknown_decision') ? 'undecided' : (decision as Decision),
      decisionReason: typeof body.decisionReason === 'string' ? body.decisionReason.trim() || null : null,
      submitted,
      result: problems.includes('unknown_result') ? null : (result as Result | null),
      awardedTo: typeof body.awardedTo === 'string' ? body.awardedTo.trim() || null : null,
      awardedAmount: Number.isFinite(Number(body.awardedAmount)) ? Number(body.awardedAmount) : null,
      ourRank,
      source: 'manual',
    },
    problems,
  }
}

export interface JudgedCase {
  caseId: string
  /** 그때 시스템이 낸 판정 */
  verdict: 'full' | 'partial' | 'unfit'
  score: number
  parts: Record<string, number>
  decision: Decision
  result: Result | null
  submitted: boolean | null
}

/**
 * 판정이 맞았나 — **참여한 사업만** 센다.
 *
 * 안 낸 사업은 결과가 없으니 판정의 증거가 아니다.
 * 그것까지 세면 「부적합이라 해서 안 냈고 남이 따갔다」가 성공으로 잡힌다.
 */
export function wasCorrect(c: JudgedCase): boolean | null {
  if (c.submitted !== true) return null
  if (c.result === 'won') return c.verdict !== 'unfit'
  if (c.result === 'lost') return true    // 떨어진 것 자체는 판정 오류가 아니다
  return null
}

/** 표본에서 쓸 수 있는 것만 — 참여했고 결과가 나온 것 */
export function usableSamples(cases: readonly JudgedCase[]): JudgedCase[] {
  return cases.filter((c) => c.submitted === true && (c.result === 'won' || c.result === 'lost'))
}
