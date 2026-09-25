/**
 * 통계 — **거래일 단위로 묶어 뽑는가**
 *
 * 같은 날 거래는 독립이 아니다. 그날 장이 한쪽으로 흐르면 다 같이 이기거나 다 같이 진다.
 * 거래 단위로 다시 뽑으면 표본이 실제보다 많은 척하게 되고, 신뢰구간이 좁아져
 * 「하한이 0보다 크다」가 쉽게 나온다 — 관문은 통과하고 실전에서는 안 재현되는 길이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeRandom, groupByDay, bootstrapExpectancy, bootstrapDifference, isBetterThan,
  type TradeOutcome,
} from './bootstrap.ts'
import { profitFactor, maxDrawdownR, summarize } from './metrics.ts'

const t = (day: string, r: number): TradeOutcome => ({ tradeDate: day, netPnlR: r })

/** 날마다 전부 이기거나 전부 지는 자료 — 날 안의 상관이 극단인 경우 */
function correlatedDays(dayCount: number, perDay: number): TradeOutcome[] {
  const out: TradeOutcome[] = []
  for (let d = 0; d < dayCount; d += 1) {
    const day = `2026-01-${String(d + 1).padStart(2, '0')}`
    const r = d % 2 === 0 ? 1 : -0.8
    for (let i = 0; i < perDay; i += 1) out.push(t(day, r))
  }
  return out
}

test('난수가 결정론적이다 — 같은 씨앗에 같은 순서', () => {
  const a = makeRandom(42)
  const b = makeRandom(42)
  for (let i = 0; i < 20; i += 1) assert.equal(a(), b())
  assert.notEqual(makeRandom(1)(), makeRandom(2)())
})

test('날짜로 묶고 날짜 순으로 준다', () => {
  const days = groupByDay([t('2026-01-02', 1), t('2026-01-01', 1), t('2026-01-01', -1)])
  assert.deepEqual(days.map((d) => d[0].tradeDate), ['2026-01-01', '2026-01-02'])
  assert.equal(days[0].length, 2)
})

test('★ 같은 씨앗이면 같은 구간이 나온다 — 어제 통과하고 오늘 아닌 숫자는 못 쓴다', () => {
  const trades = correlatedDays(20, 5)
  const a = bootstrapExpectancy(trades, { seed: 7, iterations: 500 })
  const b = bootstrapExpectancy(trades, { seed: 7, iterations: 500 })
  assert.deepEqual(a, b)
})

test('★ 날 단위로 묶으면 거래 단위보다 구간이 넓다 — 좁은 쪽이 거짓이다', () => {
  const trades = correlatedDays(20, 10)
  const byDay = bootstrapExpectancy(trades, { seed: 3, iterations: 800 })
  assert.ok(byDay)

  // 거래 단위로 다시 뽑는 것을 흉내낸다: 모든 거래를 서로 다른 날로 만들면 그게 거래 단위다
  const asIndependent = trades.map((x, i) => t(`2026-02-${String((i % 28) + 1).padStart(2, '0')}-${i}`, x.netPnlR))
  const byTrade = bootstrapExpectancy(asIndependent, { seed: 3, iterations: 800 })
  assert.ok(byTrade)

  const dayWidth = byDay.upper - byDay.lower
  const tradeWidth = byTrade.upper - byTrade.lower
  assert.ok(dayWidth > tradeWidth,
    `날 묶음 구간(${dayWidth.toFixed(4)})이 거래 단위(${tradeWidth.toFixed(4)})보다 안 넓다 — 상관을 무시했다`)
})

test('★ 날이 하나뿐이면 구간을 못 낸다 — 다시 뽑아도 늘 같은 자료다', () => {
  assert.equal(bootstrapExpectancy([t('2026-01-01', 1), t('2026-01-01', -1)]), null)
  assert.equal(bootstrapExpectancy([]), null)
})

test('구간이 추정값을 감싼다', () => {
  const ci = bootstrapExpectancy(correlatedDays(30, 3), { seed: 5, iterations: 800 })
  assert.ok(ci)
  assert.ok(ci.lower <= ci.estimate && ci.estimate <= ci.upper, '구간이 추정값을 안 감싼다')
  assert.equal(ci.dayCount, 30)
  assert.equal(ci.tradeCount, 90)
})

// ── 판단기 비교 ──────────────────────────────────────────

test('★ 같은 날을 본 자료만 비교한다 — 다른 날을 섞으면 장의 차이를 판단기 차이로 읽는다', () => {
  const a = [t('2026-01-01', 1), t('2026-01-02', 1), t('2026-01-03', 1)]
  const b = [t('2026-02-01', -1), t('2026-02-02', -1), t('2026-02-03', -1)]
  assert.equal(bootstrapDifference(a, b), null, '겹치는 날이 없는데 비교했다')
})

test('★ 확실히 나은 판단기는 하한이 0보다 크다', () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`)
  const a = days.map((d) => t(d, 0.5))
  const b = days.map((d) => t(d, -0.2))
  const diff = bootstrapDifference(a, b, { seed: 11, iterations: 800 })
  assert.ok(diff)
  assert.ok(diff.lower > 0, `하한이 ${diff.lower} 다`)
  assert.deepEqual(isBetterThan(diff, 0.05), { better: true, reason: `better_by:${diff.estimate.toFixed(4)}` })
})

test('★ 하한만 보면 안 된다 — 개선폭이 작으면 낫다고 안 한다', () => {
  const days = Array.from({ length: 40 }, (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`)
  const a = days.map((d) => t(d, 0.101))
  const b = days.map((d) => t(d, 0.1))
  const diff = bootstrapDifference(a, b, { seed: 13, iterations: 800 })
  assert.ok(diff)
  const verdict = isBetterThan(diff, 0.05)
  assert.equal(verdict.better, false, '+0.001R 차이로 「낫다」고 말했다')
  assert.match(verdict.reason, /^improvement_below_minimum/)
})

test('겹치는 날이 모자라면 비교 못 한다고 말한다', () => {
  assert.deepEqual(isBetterThan(null, 0.05), { better: false, reason: 'not_enough_shared_days' })
})

// ── 성과 지표 ────────────────────────────────────────────

test('★ 잃은 것이 0이면 PF 가 무한이 아니라 null — 세 건으로 관문을 통과한다', () => {
  assert.equal(profitFactor([t('2026-01-01', 1), t('2026-01-02', 2)]), null)
  assert.equal(profitFactor([t('2026-01-01', 2), t('2026-01-02', -1)]), 2)
  assert.equal(profitFactor([]), null)
})

test('최대 낙폭은 고점 대비 최대 하락이다', () => {
  // +1 → -2 → +0.5 : 고점 1, 저점 -1 → 낙폭 2
  assert.equal(maxDrawdownR([t('2026-01-01', 1), t('2026-01-02', -2), t('2026-01-03', 0.5)]), 2)
  assert.equal(maxDrawdownR([t('2026-01-01', 1), t('2026-01-02', 1)]), 0)
  assert.equal(maxDrawdownR([]), 0)
})

test('★ 낙폭은 시간 순서를 따른다 — 정렬을 안 하면 값이 달라진다', () => {
  const ordered = [t('2026-01-01', -2), t('2026-01-02', 3)]
  const shuffled = [t('2026-01-02', 3), t('2026-01-01', -2)]
  assert.equal(maxDrawdownR(ordered), maxDrawdownR(shuffled))
  assert.equal(maxDrawdownR(ordered), 2)
})

test('요약이 거래 수와 날 수를 따로 센다 — 실제 표본 크기는 날 수다', () => {
  const summary = summarize(correlatedDays(10, 5))
  assert.equal(summary.tradeCount, 50)
  assert.equal(summary.dayCount, 10)
  assert.equal(summary.winRate, 0.5)
})
