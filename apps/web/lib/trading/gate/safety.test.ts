/**
 * 안전 게이트 — **판단할 수 있는 상태인가를 먼저 묻는다**
 *
 * 순서를 바꾸면 데이터가 깨진 상태에서 좋아 보이는 거래를 찾아낸다.
 * 좋아 **보이는** 것이 문제다 — 나쁜 값이면 아무도 안 따를 텐데, 그럴듯하면 따른다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkSafetyGates, newSignalAllowed, watchTasks, WATCH_ORDER,
  type SafetyContext, type SafetyThresholds, type GateId,
} from './safety.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const T: SafetyThresholds = {
  maxBrokerFailureStreak: 3,
  maxMinutesSinceRun: 3,
  maxNotifyFailureStreak: 2,
  maxUnopenedSignals: 5,
}

/** 아무 문제 없는 상태 */
const CLEAN: SafetyContext = {
  barMissingOrLate: false, spreadAbnormal: false,
  brokerFailureStreak: 0, minutesSinceLastRun: 1,
  reconciliationRequired: false,
  hasPosition: false, protectionState: 'none',
  notifyFailureStreak: 0, unopenedSignalStreak: 0,
  hasCalibration: true, hasActiveSpec: true,
  marginTight: false, aiBudgetExhausted: false,
  marketAbnormal: false, logicChangedToday: false,
}

test('아무 문제 없으면 게이트가 하나도 안 걸린다', () => {
  assert.deepEqual(checkSafetyGates(CLEAN, T), [])
  assert.equal(newSignalAllowed([]), true)
})

test('★ 열두 게이트가 전부 걸릴 수 있다 — 하나도 죽어 있지 않다', () => {
  const allBad: SafetyContext = {
    barMissingOrLate: true, spreadAbnormal: true,
    brokerFailureStreak: 9, minutesSinceLastRun: 99,
    reconciliationRequired: true,
    hasPosition: true, protectionState: 'breached',
    notifyFailureStreak: 9, unopenedSignalStreak: 9,
    hasCalibration: false, hasActiveSpec: false,
    marginTight: true, aiBudgetExhausted: true,
    marketAbnormal: true, logicChangedToday: true,
  }
  const hits = checkSafetyGates(allBad, T)
  const ids = hits.map((h) => h.id).sort()
  const expected: GateId[] = [
    'SG-01', 'SG-02', 'SG-03', 'SG-04', 'SG-05', 'SG-06',
    'SG-07', 'SG-08', 'SG-09', 'SG-10', 'SG-11', 'SG-12',
  ]
  assert.deepEqual(ids, expected, '안 걸리는 게이트가 있다 — 죽은 규칙이다')
  assert.equal(newSignalAllowed(hits), false)
})

test('★ 걸린 것을 한 번에 다 돌려준다 — 하나씩 고치고 다시 돌리게 하지 않는다', () => {
  const hits = checkSafetyGates({ ...CLEAN, marginTight: true, aiBudgetExhausted: true }, T)
  assert.equal(hits.length, 2)
})

test('★ 게이트마다 사유와 사람이 읽을 문장이 둘 다 있다', () => {
  const hits = checkSafetyGates({ ...CLEAN, reconciliationRequired: true, marketAbnormal: true }, T)
  for (const h of hits) {
    assert.ok(h.reason.length > 0, `${h.id} 에 사유가 없다`)
    assert.ok(h.userMessage.length > 0, `${h.id} 에 사람이 읽을 문장이 없다`)
  }
})

test('★ 마지막 실행을 모르면 안전으로 치지 않는다 (SG-03)', () => {
  const unknown = checkSafetyGates({ ...CLEAN, minutesSinceLastRun: null }, T)
  assert.ok(unknown.some((h) => h.id === 'SG-03'), '모르는 것을 괜찮다고 읽었다')

  const stale = checkSafetyGates({ ...CLEAN, minutesSinceLastRun: 4 }, T)
  assert.ok(stale.some((h) => h.id === 'SG-03'))
  assert.equal(checkSafetyGates({ ...CLEAN, minutesSinceLastRun: 3 }, T).length, 0)
})

test('★ 포지션이 없으면 손절 보호를 안 묻는다 — 없는 것을 지킬 수 없다', () => {
  assert.equal(checkSafetyGates({ ...CLEAN, hasPosition: false, protectionState: 'unknown' }, T).length, 0)
  assert.ok(checkSafetyGates({ ...CLEAN, hasPosition: true, protectionState: 'unknown' }, T)
    .some((h) => h.id === 'SG-05'))
})

test('★ 손절가를 지났는데 포지션이 남으면 그 사실을 문장으로 말한다', () => {
  const hit = checkSafetyGates({ ...CLEAN, hasPosition: true, protectionState: 'breached' }, T)
    .find((h) => h.id === 'SG-05')
  assert.ok(hit?.userMessage.includes('손절가를 지났는데'))
})

test('★ 보정이 없으면 막는다 (SG-08 · M3)', () => {
  assert.ok(checkSafetyGates({ ...CLEAN, hasCalibration: false }, T).some((h) => h.id === 'SG-08'))
  assert.ok(checkSafetyGates({ ...CLEAN, hasActiveSpec: false }, T).some((h) => h.id === 'SG-08'))
})

test('문턱값이 설정에서 온다 — 값을 바꾸면 판정이 바뀐다', () => {
  const ctx = { ...CLEAN, brokerFailureStreak: 2 }
  assert.equal(checkSafetyGates(ctx, T).length, 0)
  assert.ok(checkSafetyGates(ctx, { ...T, maxBrokerFailureStreak: 2 }).some((h) => h.id === 'SG-02'))
})

test('★ 게이트를 끄는 설정이 없다 — 급할 때 끄면 그 순간이 게이트가 필요한 순간이다', () => {
  const src = readFileSync(join(HERE, 'safety.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const pattern of [/enabled/i, /disabled/i, /skipGates/i, /bypass/i, /\bforce\b/i]) {
    assert.equal(pattern.test(body), false, `게이트를 끄는 값이 있다: ${pattern}`)
  }
})

// ── 우선순위 (§10.2) ─────────────────────────────────────

test('★ 우선순위가 명세 §10.2 순서다', () => {
  assert.deepEqual([...WATCH_ORDER], [
    'open_position_risk', 'protection', 'daily_loss_limit',
    'session_close', 'profit_target', 'new_signal',
  ])
})

test('★ 열린 포지션 감시는 게이트가 걸려도 안 멈춘다', () => {
  const tasks = watchTasks({ hasPosition: true, profitTargetReached: false, gateBlocked: true })
  assert.ok(tasks.includes('open_position_risk'), '게이트가 걸렸다고 포지션 감시를 멈췄다')
  assert.ok(tasks.includes('protection'))
  assert.equal(tasks.includes('new_signal'), false, '게이트가 걸렸는데 새 신호를 낸다')
})

test('★ 수익 목표에 닿아도 포지션 감시는 계속한다 — 새 신호만 멈춘다', () => {
  const tasks = watchTasks({ hasPosition: true, profitTargetReached: true, gateBlocked: false })
  assert.ok(tasks.includes('open_position_risk'), '목표를 채웠다고 포지션을 안 본다')
  assert.ok(tasks.includes('session_close'), '당일 청산 감시가 빠졌다')
  assert.equal(tasks.includes('new_signal'), false)
})

test('포지션이 없으면 포지션 관련 일은 안 한다', () => {
  const tasks = watchTasks({ hasPosition: false, profitTargetReached: false, gateBlocked: false })
  assert.equal(tasks.includes('open_position_risk'), false)
  assert.equal(tasks.includes('protection'), false)
  assert.ok(tasks.includes('new_signal'))
})

test('일이 우선순위 순서로 나온다', () => {
  const tasks = watchTasks({ hasPosition: true, profitTargetReached: false, gateBlocked: false })
  const positions = tasks.map((t) => WATCH_ORDER.indexOf(t))
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], '우선순위 순서가 아니다')
  }
})
