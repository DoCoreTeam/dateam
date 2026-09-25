/**
 * 성과 지표 — Profit Factor 와 MDD (명세 §13.5)
 *
 * 기대값 하나로는 모자란다. 평균이 같아도 **어떻게 벌었나**가 다르면 실전에서
 * 견딜 수 있는지가 다르다 — 중간에 일일 한도의 여덟 배를 잃는 구간이 있으면
 * 그 전략은 평균이 좋아도 못 쓴다(사람이 먼저 그만둔다).
 */

import type { TradeOutcome } from './bootstrap.ts'

/**
 * 번 것 ÷ 잃은 것.
 *
 * 잃은 것이 0이면 **무한이 아니라 null** 이다. 무한을 돌려주면 「PF ≥ 1.25」 관문을
 * 표본 세 건으로 통과한다.
 */
export function profitFactor(trades: readonly TradeOutcome[]): number | null {
  const wins = trades.filter((t) => t.netPnlR > 0).reduce((a, t) => a + t.netPnlR, 0)
  const losses = trades.filter((t) => t.netPnlR < 0).reduce((a, t) => a - t.netPnlR, 0)
  if (losses === 0) return null
  return wins / losses
}

/**
 * 최대 낙폭 (R 단위). 시간 순서대로 누적한 곡선의 고점 대비 최대 하락.
 *
 * 거래 순서가 중요하다 — 정렬을 안 하면 낙폭이 실제와 달라진다.
 */
export function maxDrawdownR(trades: readonly TradeOutcome[]): number {
  const ordered = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  let equity = 0
  let peak = 0
  let worst = 0
  for (const trade of ordered) {
    equity += trade.netPnlR
    if (equity > peak) peak = equity
    const drawdown = peak - equity
    if (drawdown > worst) worst = drawdown
  }
  return worst
}

/** 날짜별 누적 곡선. 화면이 그린다 */
export function equityCurve(trades: readonly TradeOutcome[]): { tradeDate: string; equityR: number }[] {
  const ordered = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  const out: { tradeDate: string; equityR: number }[] = []
  let equity = 0
  for (const trade of ordered) {
    equity += trade.netPnlR
    const last = out[out.length - 1]
    if (last && last.tradeDate === trade.tradeDate) last.equityR = equity
    else out.push({ tradeDate: trade.tradeDate, equityR: equity })
  }
  return out
}

export interface PerformanceSummary {
  tradeCount: number
  dayCount: number
  winRate: number | null
  profitFactor: number | null
  maxDrawdownR: number
  expectancyR: number | null
}

export function summarize(trades: readonly TradeOutcome[]): PerformanceSummary {
  const days = new Set(trades.map((t) => t.tradeDate))
  return {
    tradeCount: trades.length,
    dayCount: days.size,
    winRate: trades.length > 0 ? trades.filter((t) => t.netPnlR > 0).length / trades.length : null,
    profitFactor: profitFactor(trades),
    maxDrawdownR: maxDrawdownR(trades),
    expectancyR: trades.length > 0 ? trades.reduce((a, t) => a + t.netPnlR, 0) / trades.length : null,
  }
}
