/**
 * 세 층 병합과 등급 (설계서 3.8.5)
 *
 * ## 등급이 곧 무게다
 *
 * 화면에서 「확정」과 「참고」는 사용자가 들이는 시간이 다르다.
 * 그래서 등급을 **어느 층이 잡았나**로 정한다 — 판단이 아니라 출처다.
 *
 *   규칙 확정            → 확정
 *   규칙 의심 + AI       → 확정에 준함 (표시는 «규칙과 AI 동시 탐지»)
 *   AI 단독              → 의심
 *   통계 단독            → 참고
 *
 * ## 출처를 전부 남긴다
 *
 * 병합하면서 rule_id 나 model_id 를 버리면, 나중에 「이 규칙이 자주 오탐한다」를
 * 셀 수 없다. 기각 데이터로 임계값을 조정하려면 **어느 규칙이 냈는지** 알아야 한다.
 */

import type { Anomaly, AnomalyEvidence } from './engine.ts'
import type { AnomalyGrade, AnomalySeverity, RuleId } from './rules.ts'
import type { LlmCandidate } from './llm.ts'
import type { StatOutlier } from './stat.ts'

/** 표시 등급 4단계 — 설계서 3.8.5 */
export type MergedGrade = 'confirmed' | 'rule_and_ai' | 'suspected' | 'reference'

export const GRADE_ORDER: readonly MergedGrade[] = ['confirmed', 'rule_and_ai', 'suspected', 'reference']

export interface MergedAnomaly {
  title: string
  grade: MergedGrade
  severity: AnomalySeverity
  rationale: string
  evidence: AnomalyEvidence[]
  /** 어느 규칙이 냈나. 기각 데이터로 임계값을 조정하려면 이게 있어야 한다 */
  ruleIds: RuleId[]
  /** 어느 모델이 냈나 */
  modelIds: string[]
  /** 통계 층이 낸 근거 */
  statMetrics: string[]
}

/**
 * 등급을 정한다 — 출처만 보고 정한다.
 *
 * 규칙이 «확정» 으로 낸 것은 숫자가 그렇다는 뜻이라 AI 가 뭐라 하든 확정이다.
 */
export function decideGrade(input: {
  ruleGrades: readonly AnomalyGrade[]
  fromAi: boolean
  fromStat: boolean
}): MergedGrade {
  if (input.ruleGrades.includes('confirmed')) return 'confirmed'
  if (input.ruleGrades.includes('suspected')) {
    // 규칙이 의심이라 했는데 AI 도 같은 자리를 짚었다 — 둘이 우연히 같을 확률은 낮다
    return input.fromAi ? 'rule_and_ai' : 'suspected'
  }
  if (input.fromAi) return 'suspected'
  if (input.fromStat) return 'reference'
  return 'reference'
}

/** 제목이 이만큼 닮으면 같은 조항으로 본다 */
export const TITLE_SIMILARITY = 0.6

export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s/g, '')
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  let hit = 0
  for (let i = 0; i + 2 <= short.length; i++) {
    if (long.includes(short.slice(i, i + 2))) hit++
  }
  const grams = Math.max(1, short.length - 1)
  return hit / grams
}

interface Bucket {
  titles: string[]
  ruleIds: RuleId[]
  ruleGrades: AnomalyGrade[]
  modelIds: string[]
  statMetrics: string[]
  severities: AnomalySeverity[]
  rationales: string[]
  evidence: AnomalyEvidence[]
  blockIds: Set<string>
}

/**
 * 세 층 결과를 합친다.
 *
 * 같은 근거 블록을 가리키거나 제목이 닮은 것을 한 덩어리로 본다.
 */
export function mergeAnomalies(
  rules: readonly Anomaly[],
  ai: readonly LlmCandidate[],
  stat: readonly StatOutlier[],
): MergedAnomaly[] {
  const buckets: Bucket[] = []

  const place = (blockIds: string[], title: string): Bucket => {
    for (const b of buckets) {
      const shareBlock = blockIds.some((id) => b.blockIds.has(id))
      const closeTitle = b.titles.some((t) => titleSimilarity(t, title) >= TITLE_SIMILARITY)
      if (shareBlock || closeTitle) return b
    }
    const fresh: Bucket = {
      titles: [], ruleIds: [], ruleGrades: [], modelIds: [], statMetrics: [],
      severities: [], rationales: [], evidence: [], blockIds: new Set(),
    }
    buckets.push(fresh)
    return fresh
  }

  for (const r of rules) {
    const ids = r.evidence.map((e) => e.blockId)
    const b = place(ids, r.title)
    b.titles.push(r.title)
    b.ruleIds.push(r.ruleId)
    b.ruleGrades.push(r.grade)
    b.severities.push(r.severity)
    b.rationales.push(r.rationale)
    b.evidence.push(...r.evidence)
    ids.forEach((id) => b.blockIds.add(id))
  }

  for (const c of ai) {
    const b = place(c.blockIds, c.title)
    b.titles.push(c.title)
    b.modelIds.push(c.modelId)
    b.severities.push(c.severity)
    b.rationales.push(c.rationale)
    b.evidence.push(...c.blockIds.map((id) => ({ blockId: id, quote: c.quote, pageNo: null })))
    c.blockIds.forEach((id) => b.blockIds.add(id))
  }

  for (const s of stat) {
    // 통계는 근거 블록이 없다. 제목으로만 붙는다
    const b = place([], `${s.metric} 이 지난 공고 중앙값의 ${s.ratio.toFixed(1)}배`)
    b.titles.push(`${s.metric} 이 지난 공고와 다르다`)
    b.statMetrics.push(s.metric)
    b.severities.push('margin')
    b.rationales.push(`${s.metric} 값 ${s.value} 이 표본 ${s.sampleSize}건 중앙값 ${s.median} 의 ${s.ratio.toFixed(1)}배다`)
  }

  return buckets.map((b) => ({
    title: b.titles[0] ?? '이름 없는 후보',
    grade: decideGrade({
      ruleGrades: b.ruleGrades,
      fromAi: b.modelIds.length > 0,
      fromStat: b.statMetrics.length > 0,
    }),
    severity: worstSeverity(b.severities),
    rationale: Array.from(new Set(b.rationales)).join(' / '),
    evidence: dedupeEvidence(b.evidence),
    // 출처를 버리면 「이 규칙이 자주 오탐한다」를 셀 수 없다
    ruleIds: Array.from(new Set(b.ruleIds)),
    modelIds: Array.from(new Set(b.modelIds)),
    statMetrics: Array.from(new Set(b.statMetrics)),
  })).sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade))
}

/** 심각도는 가장 무거운 것을 쓴다 — 가벼운 쪽으로 접으면 놓친다 */
const SEVERITY_ORDER: readonly AnomalySeverity[] = ['blocking', 'margin', 'contract', 'competition']

function worstSeverity(list: readonly AnomalySeverity[]): AnomalySeverity {
  for (const s of SEVERITY_ORDER) if (list.includes(s)) return s
  return 'competition'
}

function dedupeEvidence(list: readonly AnomalyEvidence[]): AnomalyEvidence[] {
  const seen = new Set<string>()
  const out: AnomalyEvidence[] = []
  for (const e of list) {
    const key = `${e.blockId}|${e.quote}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

/** 사용자가 기각한 것 — 규칙 임계값 조정에 쓴다 */
export interface Dismissal {
  ruleId: RuleId
  reason: string
}

/** 규칙별 기각 비율 — 높으면 임계값이 빡빡하다는 뜻이다 */
export function dismissalRate(
  produced: Readonly<Record<string, number>>,
  dismissed: readonly Dismissal[],
): Record<string, number> {
  const byRule: Record<string, number> = {}
  for (const d of dismissed) byRule[d.ruleId] = (byRule[d.ruleId] ?? 0) + 1
  const out: Record<string, number> = {}
  for (const [ruleId, n] of Object.entries(produced)) {
    if (n > 0) out[ruleId] = (byRule[ruleId] ?? 0) / n
  }
  return out
}
