/**
 * 청산 계획 — **실시간과 백테스트가 같은 값을 내놓는가** (§8 · M4)
 *
 * 사본이 있었다는 사실보다 중요한 것은 **그때 두 값이 달랐다**는 것이다.
 * 실시간 기준가는 단기 이동평균이었고 백테스트 기준가는 봉 종가였다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExitPlan, type ExitPlanParams } from './exit-plan-math.ts'
import { buildExitPlan as fromBacktest } from '../backtest/run.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLOSE = new Date('2026-09-25T06:05:00Z')
const P: ExitPlanParams = {
  stopAtrMultiple: 1.2, targetAtrMultiple: 1.5, chaseAtrMultiple: 0.3, timeExitMinutes: 15,
}

test('방향이 부호를 정한다 (§8)', () => {
  const long = buildExitPlan('long', 1100, 2, P, CLOSE)
  assert.equal(long.stopPrice, 1100 - 1.2 * 2)
  assert.equal(long.targetPrice, 1100 + 1.5 * 2)
  assert.equal(long.chaseLimitPrice, 1100 + 0.3 * 2)

  const short = buildExitPlan('short', 1100, 2, P, CLOSE)
  assert.equal(short.stopPrice, 1100 + 1.2 * 2)
  assert.equal(short.targetPrice, 1100 - 1.5 * 2)
  // 숏에서 「최대 진입가」를 쓰면 위험을 작게 계산한다 (D-31)
  assert.equal(short.chaseLimitPrice, 1100 - 0.3 * 2)
})

test('★ 백테스트가 부르는 것이 같은 함수다 — 사본이 아니다', () => {
  assert.equal(fromBacktest, buildExitPlan, '백테스트가 다른 함수를 부른다')
  for (const d of ['long', 'short'] as const) {
    assert.deepEqual(
      fromBacktest(d, 1103.25, 1.7, P, CLOSE),
      buildExitPlan(d, 1103.25, 1.7, P, CLOSE),
      `${d} 에서 두 쪽 값이 다르다`)
  }
})

/**
 * **기준가가 갈라져 있었다.**
 *
 * 실시간 `referencePrice: indicators.smaFast` vs 백테스트 `signalPrice = current.close`.
 * 돌파 신호에서 둘은 크게 벌어진다 — 같은 전략을 두 가격으로 재고 있었다.
 */
test('★ 실시간 기준가가 확정 봉 종가다 — 이동평균이 아니다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.equal(tick.includes('referencePrice: indicators.smaFast'), false,
    '단기 이동평균을 기준가로 쓴다 — 백테스트는 봉 종가를 쓴다')
  assert.ok(tick.includes('referencePrice: decision.bar.close'),
    '확정 봉 종가를 기준가로 안 넘긴다')

  const run = readFileSync(join(HERE, '..', 'backtest', 'run.ts'), 'utf8')
  assert.ok(run.includes('const signalPrice = current.close'),
    '백테스트 기준가가 봉 종가가 아니다 — 둘이 또 갈라졌다')
})

test('★ 신호 발행이 그 함수를 실제로 부른다 — 식을 다시 적지 않는다', () => {
  const emit = readFileSync(join(HERE, '..', 'jobs', 'emit-signal.ts'), 'utf8')
  assert.ok(emit.includes("from '../judge/exit-plan-math.ts'"), '같은 함수를 안 들여온다')
  assert.ok(emit.includes('buildExitPlan('), '들여오고 안 부른다')
  assert.equal(/stopAtrMultiple \* atr/.test(emit), false, '손절 식을 여기서 또 적는다')
  assert.equal(/targetAtrMultiple \* atr/.test(emit), false, '목표 식을 여기서 또 적는다')
})
