/**
 * 슬리피지 — **고정값이 아니라 우리가 모은 호가로 잰다**
 *
 * 고정값이면 개장 직후와 점심때가 같은 비용이 된다. 실제로는 스프레드가 몇 배씩 다르고
 * 그 차이가 그대로 기대값의 차이다. 그리고 가정으로 떨어진 비율이 높으면
 * 그 성적은 실측이 아니라 **우리가 정한 숫자**다 — 그 사실이 결과에 남아야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  phaseOf, spreadTicks, spreadStats, roundTripSlippagePoints,
  sensitivityTable, typicalTicks, fallbackRatio,
  SENSITIVITY_TICKS, HARSH_TICKS, type PhasedSample,
} from './slippage.ts'

const MINI_TICK = 0.02
const REGULAR_TICK = 0.05
const PARAMS = { tickSize: MINI_TICK, fallbackTicks: 2 }
const at = (m: number) => new Date(Date.parse('2026-09-25T00:00:00Z') + m * 60_000)

const sample = (phase: PhasedSample['phase'], bid: number | null, ask: number | null, m = 0): PhasedSample =>
  ({ startAt: at(m), bestBid: bid, bestAsk: ask, phase })

test('세션 구간이 개장 직후·중간·마감 전으로 갈린다', () => {
  assert.equal(phaseOf(0, 400), 'open')
  assert.equal(phaseOf(29, 400), 'open')
  assert.equal(phaseOf(30, 400), 'mid')
  assert.equal(phaseOf(200, 31), 'mid')
  assert.equal(phaseOf(200, 30), 'close')
  assert.equal(phaseOf(200, 0), 'close')
})

test('스프레드를 틱으로 잰다', () => {
  assert.equal(spreadTicks(sample('mid', 1100.00, 1100.02), MINI_TICK), 1)
  assert.equal(spreadTicks(sample('mid', 1100.00, 1100.08), MINI_TICK), 4)
})

test('★ 호가가 없거나 뒤집혀 있으면 null — 음수 비용을 만들지 않는다', () => {
  assert.equal(spreadTicks(sample('mid', null, 1100.02), MINI_TICK), null)
  assert.equal(spreadTicks(sample('mid', 1100.00, null), MINI_TICK), null)
  assert.equal(spreadTicks(sample('mid', 1100.10, 1100.00), MINI_TICK), null, '뒤집힌 호가를 음수로 받았다')
  assert.equal(spreadTicks(sample('mid', 1100.00, 1100.02), 0), null)
})

test('★ 시간대별로 나눠 재고, 중앙값을 쓴다 — 한 번의 이상치가 전체를 끌지 않게', () => {
  const stats = spreadStats([
    sample('open', 1100.00, 1100.06), // 3틱
    sample('open', 1100.00, 1100.08), // 4틱
    sample('open', 1100.00, 1101.00), // 50틱 (이상치)
    sample('mid', 1100.00, 1100.02),  // 1틱
    sample('mid', 1100.00, 1100.02),  // 1틱
  ], PARAMS)

  const open = stats.find((s) => s.phase === 'open')
  const mid = stats.find((s) => s.phase === 'mid')
  assert.equal(open?.medianTicks, 4, '이상치 50틱이 평균처럼 끌고 갔다')
  assert.equal(mid?.medianTicks, 1)
  assert.ok((open?.medianTicks ?? 0) > (mid?.medianTicks ?? 0), '개장 직후가 더 넓어야 한다')
})

test('★ 호가를 못 받은 봉은 가정값으로 떨어지고 그 수가 남는다', () => {
  const stats = spreadStats([
    sample('mid', 1100.00, 1100.02),
    sample('mid', null, null),
    sample('mid', null, null),
  ], PARAMS)
  const mid = stats.find((s) => s.phase === 'mid')
  assert.equal(mid?.sampleCount, 1)
  assert.equal(mid?.fallbackCount, 2, '가정으로 떨어진 봉 수가 안 남으면 실측인지 아닌지 모른다')
})

test('★ 호가가 하나도 없는 구간은 중앙값이 가정값이다 — 0 이 아니다', () => {
  const stats = spreadStats([sample('close', null, null)], PARAMS)
  assert.equal(stats[0].medianTicks, PARAMS.fallbackTicks, '스프레드 0 인 구간을 만들면 비용 없이 거래된다')
})

test('표본이 하나도 없는 구간은 결과에 안 넣는다', () => {
  assert.deepEqual(spreadStats([], PARAMS), [])
})

// ── 왕복과 민감도 ────────────────────────────────────────

test('★ 슬리피지는 왕복이다 — 편도로 재면 비용이 절반이 되고 기대값이 부푼다', () => {
  assert.equal(roundTripSlippagePoints(2, MINI_TICK), 0.08, '2틱 × 0.02 × 2(왕복) = 0.08')
  assert.equal(roundTripSlippagePoints(1, REGULAR_TICK), 0.1)
  assert.equal(roundTripSlippagePoints(-1, MINI_TICK), 0, '음수 틱을 이익으로 만들지 않는다')
})

test('★ 틱을 늘리면 비용이 단조 증가한다', () => {
  const table = sensitivityTable('mini', MINI_TICK)
  assert.deepEqual(table.map((c) => c.ticks), [...SENSITIVITY_TICKS])
  for (let i = 1; i < table.length; i += 1) {
    assert.ok(table[i].roundTripPoints > table[i - 1].roundTripPoints,
      `${table[i].ticks}틱이 ${table[i - 1].ticks}틱보다 안 비싸다`)
  }
})

test('★ 가혹 조건이 명세 §13.5 와 같다 — 미니 4틱, 정규 2틱', () => {
  assert.equal(HARSH_TICKS.mini, 4)
  assert.equal(HARSH_TICKS.regular, 2)

  const mini = sensitivityTable('mini', MINI_TICK)
  assert.equal(mini.filter((c) => c.harsh).length, 1)
  assert.equal(mini.find((c) => c.harsh)?.ticks, 4)

  const regular = sensitivityTable('regular', REGULAR_TICK)
  assert.equal(regular.find((c) => c.harsh)?.ticks, 2)
})

test('보통 틱 수는 시간대 중앙값들의 중앙값이다', () => {
  const stats = spreadStats([
    sample('open', 1100.00, 1100.08), // 4틱
    sample('mid', 1100.00, 1100.02),  // 1틱
    sample('close', 1100.00, 1100.04), // 2틱
  ], PARAMS)
  assert.equal(typicalTicks(stats, PARAMS), 2)
  assert.equal(typicalTicks([], PARAMS), PARAMS.fallbackTicks, '표본이 없으면 가정값이다')
})

test('★ 가정으로 떨어진 비율을 셀 수 있다 — 높으면 그 성적은 실측이 아니다', () => {
  const stats = spreadStats([
    sample('mid', 1100.00, 1100.02),
    sample('mid', null, null),
    sample('mid', null, null),
    sample('mid', null, null),
  ], PARAMS)
  assert.equal(fallbackRatio(stats), 0.75)
  assert.equal(fallbackRatio([]), 1, '표본이 0이면 전부 가정이다')
})
