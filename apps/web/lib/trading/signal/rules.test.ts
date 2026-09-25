/**
 * 신호 규칙 — **SR-01 과 SR-12 는 다른 것을 본다**
 *
 * 둘 다 「비용」이 들어가지만 SR-01 은 이미 뺀 값을, SR-12 는 안 뺀 값을 본다.
 * 헷갈려 SR-01 에서 비용을 또 빼면 이중 차감이 되고 좋은 신호가 전부 막힌다(D-34).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkSignalRules, signalAllowed,
  type SignalRuleContext, type SignalRuleThresholds,
} from './rules.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const T: SignalRuleThresholds = {
  minNetExpectedValueR: 0.1,
  minEnterNowProb: 0.5,
  openingBlockMinutes: 5,
  closingBlockMinutes: 30,
  dailyTargetKrw: 300_000,
  cooldownAfterLosses: 2,
  cooldownMinutes: 60,
  maxSignalsPerDay: 6,
  sameDirectionGapMinutes: 10,
  minTargetCostMultiple: 3,
}

/** 아무 규칙도 안 걸리는 상태 */
const CLEAN: SignalRuleContext = {
  calibratedProb: 0.65,
  netExpectedValueR: 0.3,
  enterNowProb: 0.7,
  holdDominant: false,
  minutesSinceOpen: 60,
  minutesUntilClose: 120,
  rolloverOrExpiryDay: false,
  inEventBlackout: false,
  realizedPnlKrw: 0,
  riskPerTradeKrw: 100_000,
  remainingLossBudgetKrw: 400_000,
  consecutiveLosses: 0,
  minutesSinceLastLoss: null,
  signalsToday: 1,
  minutesSinceSameDirection: null,
  targetDistancePoints: 1.5,
  roundTripCostPoints: 0.2,
}

test('아무 규칙도 안 걸리면 신호가 나간다', () => {
  assert.deepEqual(checkSignalRules(CLEAN, T), [])
  assert.equal(signalAllowed([]), true)
})

test('★ 보정이 없으면 통과가 아니라 신호 없음이다 (M3)', () => {
  const noCalib = checkSignalRules({ ...CLEAN, calibratedProb: null, netExpectedValueR: null }, T)
  assert.ok(noCalib.some((b) => b.id === 'SR-01'), '보정 없이 통과시켰다')
  assert.equal(signalAllowed(noCalib), false)
})

test('★ 관망이 가장 높으면 기권이다 (D-09)', () => {
  const held = checkSignalRules({ ...CLEAN, holdDominant: true }, T)
  assert.ok(held.some((b) => b.id === 'SR-01' && b.reason === 'hold_dominant'))
})

test('SR-01 은 기대값이 최소값 이상일 때만 통과한다', () => {
  assert.equal(checkSignalRules({ ...CLEAN, netExpectedValueR: 0.1 }, T).length, 0)
  const low = checkSignalRules({ ...CLEAN, netExpectedValueR: 0.05 }, T)
  assert.ok(low.some((b) => b.id === 'SR-01'))
  assert.ok(low[0].userMessage.includes('0.050'), '얼마인지가 문장에 없다')
})

test('SR-02 는 이미 추격 구간이면 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, enterNowProb: 0.3 }, T).some((b) => b.id === 'SR-02'))
  assert.ok(checkSignalRules({ ...CLEAN, enterNowProb: null }, T).some((b) => b.id === 'SR-02'))
})

test('SR-04 는 개장 직후·마감 전·교체일을 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, minutesSinceOpen: 3 }, T).some((b) => b.id === 'SR-04'))
  assert.ok(checkSignalRules({ ...CLEAN, minutesUntilClose: 20 }, T).some((b) => b.id === 'SR-04'))
  assert.ok(checkSignalRules({ ...CLEAN, rolloverOrExpiryDay: true }, T).some((b) => b.id === 'SR-04'))
  // 경계에서 한 칸 차이로 막지 않는다
  assert.equal(checkSignalRules({ ...CLEAN, minutesSinceOpen: 5 }, T).length, 0)
  assert.equal(checkSignalRules({ ...CLEAN, minutesUntilClose: 31 }, T).length, 0)
})

test('SR-05 는 등록된 이벤트 전후를 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, inEventBlackout: true }, T).some((b) => b.id === 'SR-05'))
})

test('★ SR-06 은 실현 손익만 본다 — 평가 손익이면 올랐다 내렸다 할 때마다 멈췄다 풀린다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, realizedPnlKrw: 300_000 }, T).some((b) => b.id === 'SR-06'))
  assert.equal(checkSignalRules({ ...CLEAN, realizedPnlKrw: 299_999 }, T).length, 0)

  // 맥락에 평가 손익 칸 자체가 없다 — 있으면 누군가 그걸로 판정한다
  const src = readFileSync(join(HERE, 'rules.ts'), 'utf8')
  assert.equal(/unrealized|evaluationPnl|평가 손익을 본다/.test(src), false,
    '평가 손익을 받는 칸이 있다 — 그것으로 목표를 판정하게 된다')
})

test('일일 목표가 0이면 SR-06 을 안 건다 — 목표를 안 정한 것이다', () => {
  assert.equal(checkSignalRules({ ...CLEAN, realizedPnlKrw: 999_999 }, { ...T, dailyTargetKrw: 0 }).length, 0)
})

test('SR-07 은 1회 위험이 남은 여유보다 크면 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, remainingLossBudgetKrw: 50_000 }, T).some((b) => b.id === 'SR-07'))
  assert.equal(checkSignalRules({ ...CLEAN, remainingLossBudgetKrw: 100_000 }, T).length, 0)
})

test('★ SR-08 은 마지막 손실 시각을 모르면 아직 쿨다운으로 본다', () => {
  const unknown = checkSignalRules({ ...CLEAN, consecutiveLosses: 2, minutesSinceLastLoss: null }, T)
  assert.ok(unknown.some((b) => b.id === 'SR-08'), '모르는 것을 통과로 쳤다')

  assert.ok(checkSignalRules({ ...CLEAN, consecutiveLosses: 2, minutesSinceLastLoss: 30 }, T)
    .some((b) => b.id === 'SR-08'))
  assert.equal(checkSignalRules({ ...CLEAN, consecutiveLosses: 2, minutesSinceLastLoss: 60 }, T).length, 0)
  // 연패가 기준 미만이면 안 건다
  assert.equal(checkSignalRules({ ...CLEAN, consecutiveLosses: 1, minutesSinceLastLoss: null }, T).length, 0)
})

test('SR-09 는 거래일 최대 신호 수를 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, signalsToday: 6 }, T).some((b) => b.id === 'SR-09'))
  assert.equal(checkSignalRules({ ...CLEAN, signalsToday: 5 }, T).length, 0)
})

test('SR-10 은 같은 방향 재신호 간격을 막는다', () => {
  assert.ok(checkSignalRules({ ...CLEAN, minutesSinceSameDirection: 5 }, T).some((b) => b.id === 'SR-10'))
  assert.equal(checkSignalRules({ ...CLEAN, minutesSinceSameDirection: 10 }, T).length, 0)
  assert.equal(checkSignalRules({ ...CLEAN, minutesSinceSameDirection: null }, T).length, 0)
})

test('★ SR-12 는 비용을 뺀 가격 거리로 잰다 — SR-01 과 같은 비용을 두 번 세지 않는다', () => {
  // 거리 1.5, 비용 0.2 → 7.5배 → 통과
  assert.equal(checkSignalRules(CLEAN, T).length, 0)
  // 거리 0.4, 비용 0.2 → 2배 → 미달
  const close = checkSignalRules({ ...CLEAN, targetDistancePoints: 0.4 }, T)
  assert.ok(close.some((b) => b.id === 'SR-12'))
  assert.ok(close[0].userMessage.includes('2.0배'))
})

test('★ SR-01 에서 비용을 또 빼지 않는다 (D-34)', () => {
  const src = readFileSync(join(HERE, 'rules.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  // SR-01 자리에서 비용을 빼는 식이 있으면 안 된다
  assert.equal(/netExpectedValueR\s*-\s*\w*[Cc]ost/.test(body), false, 'SR-01 에서 비용을 또 뺀다')
  assert.equal(/netExpectedValueR\s*-\s*\w*[Ff]ee/.test(body), false)
})

test('★ 여러 규칙이 걸리면 전부 돌려준다', () => {
  const many = checkSignalRules({
    ...CLEAN, signalsToday: 9, inEventBlackout: true, rolloverOrExpiryDay: true,
  }, T)
  const ids = new Set(many.map((b) => b.id))
  assert.ok(ids.has('SR-09') && ids.has('SR-05') && ids.has('SR-04'))
})

test('★ 기준값이 전부 설정에서 온다 — 코드에 숫자가 없다', () => {
  const src = readFileSync(join(HERE, 'rules.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const literal of ['0.1,', '300000', '300_000', ' 6)', '10)', ' 3)']) {
    assert.equal(body.includes(literal), false, `기준값 ${literal} 이 코드에 박혀 있다`)
  }
  for (const name of ['t.minNetExpectedValueR', 't.maxSignalsPerDay', 't.minTargetCostMultiple']) {
    assert.ok(body.includes(name), `${name} 를 안 쓴다`)
  }
})
