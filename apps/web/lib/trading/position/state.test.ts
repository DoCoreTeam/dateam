/**
 * 포지션 상태 — **모르는 전이는 던진다**
 *
 * 조용히 무시하면 상태가 그대로 남는다. 화면은 「보유 중」인데 계좌는 비어 있고,
 * 사람은 있지도 않은 포지션의 손절을 걱정한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  POSITION_STATES, POSITION_EVENTS, canTransition, nextState, UndefinedTransitionError,
  needsHumanUnlock, isWatchable,
  PROTECTION_STATES, DEFAULT_PROTECTION, isSystemVerifiedProtection, PROTECTION_LABEL,
  shouldAskProtection, detectBreach,
  ALERT_PRIORITY, alertRank, sortAlerts, topAlert,
  type PositionState, type PositionEvent, type ProtectionState,
} from './state.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-09-25T04:00:00Z')
const at = (m: number) => new Date(T0.getTime() + m * 60_000)

test('★ 명세 §11 의 다섯 상태가 그대로 있다', () => {
  assert.deepEqual([...POSITION_STATES],
    ['flat', 'entry_pending', 'holding', 'exit_pending', 'reconciliation_required'])
})

test('한 바퀴 — 주문함 → 체결 → 청산 알림 → 청산 체결', () => {
  let s: PositionState = 'flat'
  s = nextState(s, 'order_reported'); assert.equal(s, 'entry_pending')
  s = nextState(s, 'entry_filled'); assert.equal(s, 'holding')
  s = nextState(s, 'exit_reported'); assert.equal(s, 'exit_pending')
  s = nextState(s, 'exit_filled'); assert.equal(s, 'flat')
})

test('★ 정의 안 된 전이는 던진다 — 무시하면 상태가 어긋난다', () => {
  assert.throws(() => nextState('flat', 'exit_filled'), UndefinedTransitionError)
  assert.throws(() => nextState('holding', 'order_reported'), UndefinedTransitionError)
  assert.throws(() => nextState('flat', 'mismatch_resolved'), UndefinedTransitionError)
  // 사유에 무엇에서 무엇인지가 적힌다
  try { nextState('holding', 'entry_filled') } catch (e) {
    assert.ok(e instanceof UndefinedTransitionError)
    assert.equal(e.from, 'holding')
    assert.equal(e.event, 'entry_filled')
    assert.match(e.message, /holding.*entry_filled/)
  }
})

test('물어본 뒤에 가면 안 던진다', () => {
  for (const from of POSITION_STATES) {
    for (const ev of POSITION_EVENTS) {
      if (!canTransition(from, ev)) {
        assert.throws(() => nextState(from, ev), UndefinedTransitionError, `${from}/${ev}`)
        continue
      }
      assert.ok(POSITION_STATES.includes(nextState(from, ev)), `${from}/${ev} 가 이상한 상태로 간다`)
    }
  }
})

test('★ 계좌와 다르면 어느 상태에서나 대조로 간다 — 진실은 계좌다', () => {
  for (const from of POSITION_STATES) {
    assert.equal(nextState(from, 'mismatch_found'), 'reconciliation_required', `${from} 에서 안 걸린다`)
  }
})

test('★ 대조 상태는 코드가 스스로 못 푼다 — 사람 확인만 푼다', () => {
  assert.equal(needsHumanUnlock('reconciliation_required'), true)
  const unlocks = POSITION_EVENTS.filter((e) => canTransition('reconciliation_required', e))
  assert.deepEqual(unlocks.sort(), ['mismatch_found', 'mismatch_resolved'])
  // 체결을 봤다고 저절로 풀리면 안 된다. 그 체결이 어긋남의 원인일 수 있다
  for (const ev of ['entry_filled', 'exit_filled', 'order_cancelled'] as PositionEvent[]) {
    assert.equal(canTransition('reconciliation_required', ev), false, `${ev} 로 저절로 풀린다`)
  }
})

test('★ 청산 주문을 물리면 포지션이 사라지지 않고 보유로 돌아온다', () => {
  assert.equal(nextState('exit_pending', 'order_cancelled'), 'holding')
  // 진입 주문을 물리면 없음으로
  assert.equal(nextState('entry_pending', 'order_cancelled'), 'flat')
})

test('감시 대상은 열린 포지션이 있을 수 있는 상태뿐', () => {
  assert.deepEqual(POSITION_STATES.filter(isWatchable), ['entry_pending', 'holding', 'exit_pending'])
})

// ── 손절 보호 (D-15 · D-47) ──────────────────────────────

test('★ 시스템은 어떤 값도 「보호됨」으로 안 본다 — 주문을 안 하니 확인할 길이 없다', () => {
  for (const s of PROTECTION_STATES) {
    assert.equal(isSystemVerifiedProtection(s), false, `${s} 를 보호됨으로 본다`)
  }
})

test('★ 기본은 「모름」이지 「없음」이 아니다', () => {
  assert.equal(DEFAULT_PROTECTION, 'unknown')
  assert.notEqual(DEFAULT_PROTECTION, 'none')
})

test('★ 화면 문구에 「보호」라는 말이 없다 — 사용자 입력이라고 적는다', () => {
  assert.equal(PROTECTION_LABEL.user_reported, '사용자 입력')
  for (const [key, label] of Object.entries(PROTECTION_LABEL)) {
    assert.equal(/보호|안전|확인됨/.test(label), false, `${key} 문구가 보호됐다고 말한다: ${label}`)
  }
})

test('한 번도 안 눌렀으면 묻는다', () => {
  const r = shouldAskProtection(
    { state: 'unknown', reportedAt: null, positionChangedSince: false, recheckMinutes: 30 }, T0)
  assert.equal(r.ask && r.reason, 'never_reported')
})

test('★ 포지션이 바뀌면 다시 묻는다 — 이전 손절가는 다른 포지션의 것이다', () => {
  const r = shouldAskProtection(
    { state: 'user_reported', reportedAt: T0, positionChangedSince: true, recheckMinutes: 30 }, at(1))
  assert.equal(r.ask && r.reason, 'position_changed')
})

test('★ 설정 시간이 지나면 다시 묻는다', () => {
  const ctx = { state: 'user_reported' as ProtectionState, reportedAt: T0, positionChangedSince: false, recheckMinutes: 30 }
  assert.equal(shouldAskProtection(ctx, at(29)).ask, false)
  assert.equal(shouldAskProtection(ctx, at(30)).ask, true)
  assert.equal(shouldAskProtection(ctx, at(30)).ask && shouldAskProtection(ctx, at(30)).reason, 'stale')
})

test('이미 손절가를 지났으면 더 묻지 않는다 — 물을 때가 아니라 알릴 때다', () => {
  assert.equal(shouldAskProtection(
    { state: 'breached', reportedAt: null, positionChangedSince: true, recheckMinutes: 1 }, at(999)).ask, false)
})

test('★ 손절가를 지난 것을 방향에 맞게 본다', () => {
  const base = { positionState: 'holding' as PositionState, stopPrice: 300 }
  assert.equal(detectBreach({ ...base, direction: 'long', observedPrice: 299.95 }), true)
  assert.equal(detectBreach({ ...base, direction: 'long', observedPrice: 300 }), true)
  assert.equal(detectBreach({ ...base, direction: 'long', observedPrice: 300.05 }), false)
  assert.equal(detectBreach({ ...base, direction: 'short', observedPrice: 300.05 }), true)
  assert.equal(detectBreach({ ...base, direction: 'short', observedPrice: 299.95 }), false)
})

test('★ 포지션이 없으면 손절가를 지나도 이탈이 아니다', () => {
  for (const s of ['flat', 'entry_pending', 'reconciliation_required'] as PositionState[]) {
    assert.equal(detectBreach({ positionState: s, direction: 'long', stopPrice: 300, observedPrice: 290 }), false, s)
  }
  // 청산 주문을 냈는데 아직 안 채워진 것은 아직 들고 있는 것이다
  assert.equal(detectBreach({ positionState: 'exit_pending', direction: 'long', stopPrice: 300, observedPrice: 290 }), true)
})

test('★ 가격 관측이 포지션 상태를 안 바꾼다 (D-32)', () => {
  const src = readFileSync(join(HERE, 'state.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function detectBreach'))
  assert.equal(/nextState|TRANSITIONS/.test(fn.slice(0, fn.indexOf('\n}'))), false,
    'detectBreach 가 상태를 바꾼다 — 관측은 체결이 아니다')
})

// ── 알림 우선순위 (§10.2) ────────────────────────────────

test('★ 손절가 이탈이 맨 앞이다', () => {
  assert.equal(alertRank('protection_breached'), 0)
  assert.ok(alertRank('protection_breached') < alertRank('new_signal'))
  assert.ok(alertRank('open_position_risk') < alertRank('daily_limit'))
  assert.ok(alertRank('daily_limit') < alertRank('session_close'))
  assert.ok(alertRank('session_close') < alertRank('profit_target'))
  assert.ok(alertRank('profit_target') < alertRank('new_signal'))
})

test('급이 겹치지 않는다', () => {
  assert.equal(new Set(ALERT_PRIORITY).size, ALERT_PRIORITY.length)
})

test('★ 손절가를 지난 판에서 새 신호를 먼저 보여 주지 않는다', () => {
  assert.deepEqual(sortAlerts(['new_signal', 'protection_breached']), ['protection_breached', 'new_signal'])
  assert.equal(topAlert({ position: 'holding', protection: 'breached' }), 'protection_breached')
  assert.equal(topAlert({ position: 'reconciliation_required', protection: 'unknown' }), 'reconciliation_required')
  assert.equal(topAlert({ position: 'holding', protection: 'unknown' }), 'open_position_risk')
  assert.equal(topAlert({ position: 'flat', protection: 'none' }), null)
})
