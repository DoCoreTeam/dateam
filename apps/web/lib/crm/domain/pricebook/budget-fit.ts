/**
 * 예산 맞추기 — 단가가 아니라 할인 칸으로 맞춘다
 *
 * 예전 「목표 총액 맞추기」(`quote-target.ts`)는 모든 줄의 단가를 같은 비율로 깎았다.
 * 할인 칸이 0 이라 3억을 2억에 맞춰 33%를 깎아도 할인 승인이 안 걸렸다(실제 함수로 확인).
 * 정상가 7,300,000원이 7,061,234원 같은 숫자가 되고, 구축비와 크레딧까지 줄었다.
 *
 * 여기서는
 *   · 단가와 정상가는 그대로 두고, 할인할 수 있는 줄의 할인 칸에 하나의 할인율을 넣는다
 *   · 구축비, 크레딧, 비율 항목, 사람이 잠근 칸은 빼고 센다
 *   · 할인율은 소수 둘째 자리 — 남는 끝전은 묶음 절사와 합계 절사가 맡고, 단가를 1원씩 바꾸지 않는다
 *   · 예산이 정상가보다 크면 값을 올리지 않는다
 *   · 할인 승인 기준(기본 15%)을 넘는 할인은 넣지 않는다. 필요한 할인율만 돌려주고 넣는 것은 사람이 정한다
 *     (실측 2026-10-20: 상한이 없어 정상가 6억대 표를 2천만원에 맞추며 모든 줄에 96.81% 를 넣었다)
 */

import { composeQuote, supplyOf, type ComposeLine, type ComposeRounding, type ComposeSection } from '../quote-compose.ts'
import { DEFAULT_DISCOUNT_APPROVAL_PCT } from '../quote-math.ts'
import { toMinor } from '../money.ts'

export interface FitLine extends ComposeLine {
  /** 할인 규칙이 걸리는 줄인가 */
  discountable: boolean
  /** 사람이 고친 할인 칸 — 예산 맞추기가 덮지 않는다 */
  locked?: boolean
}

export type FitReason = 'FITTED' | 'ALREADY_UNDER' | 'BUDGET_ABOVE_LIST' | 'NOT_ENOUGH' | 'NO_DISCOUNTABLE' | 'OVER_CAP'

export interface FitResult {
  lines: FitLine[]
  /** 넣은 할인율(%) — 소수 둘째 자리. 손대지 않았으면 null */
  discountPct: number | null
  achievedMinor: bigint
  /** 예산 − 맞춘 금액. 양수면 예산보다 그만큼 적다 */
  gapMinor: bigint
  reason: FitReason
  /** 예산에 닿는 데 필요한 할인율(%) — 상한을 넘어 넣지 않았을 때만 */
  neededPct?: number
}

export interface FitOptions {
  /** 저절로 넣는 할인의 상한(%) — 기본은 할인 승인 기준 */
  maxPct?: number
  /** 사람이 「그래도 넣기」를 눌렀을 때만 true */
  allowOverCap?: boolean
}

const BP_MAX = 10_000

function measure(lines: readonly FitLine[], sections: readonly ComposeSection[], rounding: ComposeRounding, includesTax: boolean): bigint {
  const q = composeQuote(lines, sections, rounding)
  if (includesTax) return q.once.totalMinor
  return supplyOf(q.once)
}

function withPct(lines: readonly FitLine[], bp: number): FitLine[] {
  const pct = bp / 100
  return lines.map((l) => (l.discountable && !l.locked && l.billing !== 'ANNUAL' && !isRatio(l)
    ? { ...l, discountPercent: Math.max(pct, Number(l.discountPercent ?? 0)) }
    : l))
}

function isRatio(l: FitLine): boolean {
  return l.ratioPct !== null && l.ratioPct !== undefined && String(l.ratioPct).trim() !== ''
}

/**
 * 예산에 맞춘다. 할인율이 오를수록 금액은 줄기만 하므로(단조) 이분 탐색으로 가장 작은 할인율을 찾는다.
 * 규칙 할인이 이미 그보다 크면 그 줄은 규칙 할인을 그대로 둔다.
 */
export function fitToBudget(
  lines: readonly FitLine[],
  sections: readonly ComposeSection[],
  budget: { totalMinor: bigint | number | string; includesTax: boolean },
  rounding: ComposeRounding = {},
  opts: FitOptions = {},
): FitResult {
  const target = toMinor(budget.totalMinor)
  const now = measure(lines, sections, rounding, budget.includesTax)
  if (now <= target) {
    return { lines: [...lines], discountPct: null, achievedMinor: now, gapMinor: target - now, reason: now === target ? 'FITTED' : 'ALREADY_UNDER' }
  }
  const adjustable = lines.some((l) => l.discountable && !l.locked && l.billing !== 'ANNUAL' && !isRatio(l))
  if (!adjustable) return { lines: [...lines], discountPct: null, achievedMinor: now, gapMinor: target - now, reason: 'NO_DISCOUNTABLE' }

  const capBp = Math.min(BP_MAX, Math.round((opts.maxPct ?? DEFAULT_DISCOUNT_APPROVAL_PCT) * 100))
  const capped = () => {
    const l = withPct(lines, capBp)
    return { lines: l, at: measure(l, sections, rounding, budget.includesTax) }
  }
  // 다 깎아도 못 닿으면 구성이 예산보다 크다는 뜻이다 — 100% 를 넣지 않고 상한까지만 넣는다
  const floor = measure(withPct(lines, BP_MAX), sections, rounding, budget.includesTax)
  if (floor > target) {
    const c = capped()
    return { lines: c.lines, discountPct: capBp / 100, achievedMinor: c.at, gapMinor: target - c.at, reason: 'NOT_ENOUGH' }
  }

  let lo = 0, hi = BP_MAX
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (measure(withPct(lines, mid), sections, rounding, budget.includesTax) <= target) hi = mid
    else lo = mid + 1
  }
  if (lo > capBp && !opts.allowOverCap) {
    const c = capped()
    return { lines: c.lines, discountPct: capBp / 100, achievedMinor: c.at, gapMinor: target - c.at, reason: 'OVER_CAP', neededPct: lo / 100 }
  }
  const fitted = withPct(lines, lo)
  const achieved = measure(fitted, sections, rounding, budget.includesTax)
  return { lines: fitted, discountPct: lo / 100, achievedMinor: achieved, gapMinor: target - achieved, reason: 'FITTED' }
}

/** 예산이 정상가 합계보다 큰가 — 값을 올리지 않고 「n원 남아요」로 말한다 */
export function budgetAboveList(achievedMinor: bigint, budgetMinor: bigint): bigint | null {
  return budgetMinor > achievedMinor ? budgetMinor - achievedMinor : null
}
