/**
 * 레이더 훑기 (설계서 F8)
 *
 * ## 자동은 «찾기» 까지다
 *
 * 후보를 찾아 점수를 매기는 것까지가 자동이고, **케이스로 만드는 것은 사람이 한다.**
 * 자동으로 케이스를 만들면 분석 비용이 자동으로 나가고, 아무도 안 볼 리포트가 쌓인다.
 *
 * ## 같은 공고를 두 번 안 담는다
 *
 * 크론이 15분마다 돈다. 담을 때마다 행이 늘면 목록이 같은 공고로 채워지고
 * 사용자는 레이더를 끈다.
 */

import type { RadarRule } from './rules.ts'

export interface NoticeCandidate {
  sourceId: string
  noticeNo: string
  title: string
  agency: string | null
  budgetAmount: number | null
  classification: string | null
  noticeDate: string | null
}

export interface RadarHit {
  ruleId: string
  sourceId: string
  score: number
  /** 왜 걸렸나 — 화면이 그대로 보여 준다 */
  reason: string
}

/** 무엇이 맞으면 몇 점인가 */
export const SCORE = {
  keyword: 30,
  classification: 25,
  agency: 20,
  budget: 15,
  /** 최근 공고일수록 조금 더 */
  fresh: 10,
} as const

/**
 * 규칙 하나로 후보를 훑는다.
 *
 * 조건이 **하나도 안 맞으면 안 담는다** — 규칙에 조건이 있는데 아무것도 안 맞았으면
 * 그 공고는 그 규칙이 찾던 것이 아니다.
 */
export function matchRule(
  rule: RadarRule,
  candidates: readonly NoticeCandidate[],
  now: () => number = () => Date.now(),
): RadarHit[] {
  if (!rule.enabled) return []
  const hits: RadarHit[] = []

  for (const c of candidates) {
    let score = 0
    const reasons: string[] = []

    const text = `${c.title} ${c.classification ?? ''}`
    const kw = rule.keywords.find((k) => text.includes(k))
    if (kw) { score += SCORE.keyword; reasons.push(`키워드 「${kw}」`) }

    if (rule.classifications.length > 0 && c.classification
        && rule.classifications.includes(c.classification)) {
      score += SCORE.classification
      reasons.push(`분류 ${c.classification}`)
    }

    if (rule.agencies.length > 0 && c.agency && rule.agencies.some((a) => c.agency!.includes(a))) {
      score += SCORE.agency
      reasons.push(`기관 ${c.agency}`)
    }

    if (c.budgetAmount !== null && inBudget(rule, c.budgetAmount)) {
      score += SCORE.budget
      reasons.push('예산 범위 안')
    }

    if (score === 0) continue

    if (c.noticeDate) {
      const days = (now() - Date.parse(c.noticeDate)) / 86_400_000
      if (Number.isFinite(days) && days <= FRESH_DAYS) {
        score += SCORE.fresh
        reasons.push('최근 공고')
      }
    }

    hits.push({ ruleId: rule.id, sourceId: c.sourceId, score, reason: reasons.join(', ') })
  }

  // 점수 높은 것부터 — 사용자는 위에서 몇 개만 본다
  return hits.sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
}

export const FRESH_DAYS = 3

function inBudget(rule: RadarRule, amount: number): boolean {
  if (rule.budgetMin === null && rule.budgetMax === null) return false
  if (rule.budgetMin !== null && amount < rule.budgetMin) return false
  if (rule.budgetMax !== null && amount > rule.budgetMax) return false
  return true
}

/**
 * 이미 담은 것을 뺀다.
 *
 * DB 유니크 `(rule_id, source_id)` 가 최종 방어이고, 여기서 먼저 거르는 이유는
 * **넣어 보고 실패하는 것을 매번 반복하지 않기 위해서**다.
 */
export function excludeSeen(
  hits: readonly RadarHit[],
  seen: readonly { ruleId: string; sourceId: string }[],
): RadarHit[] {
  const keys = new Set(seen.map((s) => `${s.ruleId}|${s.sourceId}`))
  return hits.filter((h) => !keys.has(`${h.ruleId}|${h.sourceId}`))
}

/** 여러 규칙을 한 번에. 같은 공고가 여러 규칙에 걸리면 점수가 가장 높은 것만 남긴다 */
export function sweep(
  rules: readonly RadarRule[],
  candidates: readonly NoticeCandidate[],
  seen: readonly { ruleId: string; sourceId: string }[],
  now: () => number = () => Date.now(),
): RadarHit[] {
  const all = rules.flatMap((r) => matchRule(r, candidates, now))
  const fresh = excludeSeen(all, seen)

  const best = new Map<string, RadarHit>()
  for (const h of fresh) {
    const prev = best.get(h.sourceId)
    // 같은 공고가 여러 규칙에 걸리면 목록에 두 줄이 뜬다
    if (!prev || h.score > prev.score) best.set(h.sourceId, h)
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
}

/** 레이더가 자동으로 하는 마지막 단계 — 여기서 멈춘다 */
export type HitStatus = 'new' | 'opened' | 'dismissed'

/**
 * 케이스로 만들 수 있나 — **사람이 열어야 만들 수 있다.**
 *
 * 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다.
 */
export function canCreateCase(status: HitStatus): boolean {
  return status === 'opened'
}
