/**
 * 관문 — **「미달」과 「아직 못 잼」은 다른 상태다**
 *
 * 표본 80건으로 「기대값 하한이 0 이하라 미달」이라고 말하면 읽는 사람은 전략이 나쁘다고
 * 읽는다. 사실은 아직 아무것도 모르는 것이다. 그 둘을 섞으면 멀쩡한 전략을 버리거나,
 * 반대로 표본이 없는데 통과시킨다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateGate, type GateInput, type GateThresholds } from './criteria.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const T: GateThresholds = {
  minValidateTrades: 500,
  minLockboxTrades: 100,
  minProfitFactor: 1.25,
  maxDrawdownLimitMultiple: 8,
  dailyLossLimitKrw: 500_000,
  minJudgeImprovementR: 0.05,
}

/** 전부 통과하는 입력 */
const GOOD: GateInput = {
  thresholds: T,
  validateTradeCount: 600,
  lockboxTradeCount: 150,
  validateExpectancy: { estimate: 0.3, lower: 0.1, upper: 0.5 },
  lockboxExpectancy: { estimate: 0.25, lower: 0.05, upper: 0.45 },
  harshExpectancyR: 0.12,
  profitFactor: 1.4,
  maxDrawdownR: 20,
  riskPerTradeKrw: 100_000,
  calibration: { betterThanBaseRate: true, monotonic: true, insufficient: false },
  judgeComparison: { better: true, reason: 'better_by:0.1200' },
  riskArithmeticOk: true,
}

/**
 * 명세 §13.5 는 여덟 줄인데 재는 것은 **열 가지**다.
 * 「거래 수」 줄이 검증 합계와 Lockbox 둘을 말하고,
 * 「기대값 하한」 줄이 하한과 Lockbox 일관성 둘을 말하기 때문이다.
 * 한 줄로 합치면 어느 쪽이 모자란지가 사라진다.
 */
test('★ 명세 여덟 줄이 열 가지 판정으로 펼쳐지고, 전부 좋으면 통과한다', () => {
  const verdict = evaluateGate(GOOD)
  assert.equal(verdict.passed, true, verdict.criteria.filter((c) => c.status !== 'pass').map((c) => c.detail).join(' / '))
  assert.equal(verdict.failedCount, 0)
  assert.equal(verdict.insufficientCount, 0)
  assert.deepEqual(verdict.criteria.map((c) => c.id), [
    'trade_count', 'lockbox_count', 'expectancy_lower', 'lockbox_consistency',
    'harsh_slippage', 'profit_factor', 'max_drawdown', 'calibration',
    'judge_comparison', 'risk_arithmetic',
  ])
})

test('★ 표본이 모자라면 「미달」이 아니라 「아직 못 잼」이다', () => {
  const verdict = evaluateGate({ ...GOOD, validateTradeCount: 80 })
  const tradeCount = verdict.criteria.find((c) => c.id === 'trade_count')
  assert.equal(tradeCount?.status, 'insufficient', '표본 부족을 미달로 말했다 — 멀쩡한 전략을 버리게 된다')
  assert.equal(verdict.failedCount, 0, '미달이 하나도 없는데 미달로 셌다')
  assert.equal(verdict.passed, false, '못 쟀는데 통과시켰다')
})

test('★ 하나라도 미달이면 통과가 아니다', () => {
  const verdict = evaluateGate({ ...GOOD, profitFactor: 1.1 })
  assert.equal(verdict.passed, false)
  assert.equal(verdict.failedCount, 1)
  const pf = verdict.criteria.find((c) => c.id === 'profit_factor')
  assert.equal(pf?.status, 'fail')
  assert.ok(pf?.detail.includes('1.100') && pf.detail.includes('1.25'),
    '얼마나 모자란지가 없으면 다음에 무엇을 할지 모른다')
})

test('★ 기대값 하한이 0 이하면 미달이고 얼마인지 말한다', () => {
  const verdict = evaluateGate({ ...GOOD, validateExpectancy: { estimate: 0.1, lower: -0.05, upper: 0.25 } })
  const c = verdict.criteria.find((c) => c.id === 'expectancy_lower')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('-0.050'))
})

test('★ 가혹 슬리피지에서 0 이하면 미달 — 가정이 조금만 나빠져도 뒤집히는 전략이다', () => {
  const verdict = evaluateGate({ ...GOOD, harshExpectancyR: -0.02 })
  const c = verdict.criteria.find((c) => c.id === 'harsh_slippage')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('뒤집히는'))
})

test('★ 최종 검증이 검증 구간 범위 밖이면 미달이다', () => {
  const outOfRange = evaluateGate({ ...GOOD, lockboxExpectancy: { estimate: 0.9, lower: 0.7, upper: 1.1 } })
  assert.equal(outOfRange.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'fail')

  const flipped = evaluateGate({ ...GOOD, lockboxExpectancy: { estimate: -0.2, lower: -0.4, upper: 0 } })
  assert.equal(flipped.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'fail', '부호가 뒤집혔는데 통과했다')
})

test('최종 검증을 안 열었으면 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, lockboxExpectancy: null })
  assert.equal(verdict.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'insufficient')
})

test('★ MDD 는 일일 손실 한도 × 배수로 잰다', () => {
  // 20R × 100,000원 = 2,000,000원, 상한 500,000 × 8 = 4,000,000 → 통과
  assert.equal(evaluateGate(GOOD).criteria.find((c) => c.id === 'max_drawdown')?.status, 'pass')
  // 50R × 100,000 = 5,000,000 → 미달
  const over = evaluateGate({ ...GOOD, maxDrawdownR: 50 })
  const c = over.criteria.find((c) => c.id === 'max_drawdown')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('5,000,000') && c.detail.includes('4,000,000'))
})

test('PF 를 못 재면(잃은 거래 0) 미달이 아니라 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, profitFactor: null })
  assert.equal(verdict.criteria.find((c) => c.id === 'profit_factor')?.status, 'insufficient')
})

test('보정이 기저율보다 나쁘면 미달이고 왜인지 말한다', () => {
  const worse = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: false, monotonic: true, insufficient: false } })
  const c = worse.criteria.find((c) => c.id === 'calibration')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('아무 정보도'))

  const notMono = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: true, monotonic: false, insufficient: false } })
  assert.ok(notMono.criteria.find((c) => c.id === 'calibration')?.detail.includes('오름차순'))
})

test('보정 표본이 모자라면 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: false, monotonic: false, insufficient: true } })
  assert.equal(verdict.criteria.find((c) => c.id === 'calibration')?.status, 'insufficient')
})

test('판단기가 다른 것보다 낫지 않으면 미달이다', () => {
  const verdict = evaluateGate({ ...GOOD, judgeComparison: { better: false, reason: 'lower_not_positive:-0.01' } })
  const c = verdict.criteria.find((c) => c.id === 'judge_comparison')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('lower_not_positive'))
})

test('리스크 산술이 안 맞으면 미달이다', () => {
  const verdict = evaluateGate({ ...GOOD, riskArithmeticOk: false })
  assert.equal(verdict.criteria.find((c) => c.id === 'risk_arithmetic')?.status, 'fail')
})

test('★ 관문 숫자를 코드에 박지 않는다 — 화면이 말하는 기준과 재는 기준이 갈린다', () => {
  const src = readFileSync(join(HERE, 'criteria.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const literal of ['500', '1.25', '100)', '0.05']) {
    assert.equal(body.includes(literal), false, `관문 기준 ${literal} 이 코드에 박혀 있다`)
  }
  // 전부 thresholds 에서 온다
  assert.match(body, /t\.minValidateTrades/)
  assert.match(body, /t\.minProfitFactor/)
  assert.match(body, /t\.maxDrawdownLimitMultiple/)
})
