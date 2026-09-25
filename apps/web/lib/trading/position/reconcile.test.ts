/**
 * 체결 대조 — **진실은 계좌다**
 *
 * 우리 기록을 맞다고 보면 있지도 않은 포지션의 손절을 감시하게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  reconcilePositions, stateAfterReconcile, lockReason, afterBrokerRecovery,
  MISMATCH_KINDS, type ExpectedPosition, type ActualPosition,
} from './reconcile.ts'
import { POSITION_STATES, canTransition, type PositionState } from './state.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const E = (o: Partial<ExpectedPosition> = {}): ExpectedPosition =>
  ({ contractCode: '101W12', direction: 'long', quantity: 1, ...o })
const A = (o: Partial<ActualPosition> = {}): ActualPosition =>
  ({ contractCode: '101W12', direction: 'long', quantity: 1, ...o })

test('같으면 같다고 한다', () => {
  assert.deepEqual(reconcilePositions([E()], [A()]), { match: true })
  assert.deepEqual(reconcilePositions([], []), { match: true })
})

test('★ 우리 기록에만 있으면 어긋남이다 — 없는 포지션을 감시하게 된다', () => {
  const r = reconcilePositions([E()], [])
  assert.equal(r.match, false)
  assert.equal(r.match === false && r.mismatches[0].kind, 'missing_in_account')
})

test('★ 계좌에만 있어도 어긋남이다 — 사람이 우리 모르게 연 포지션을 아무도 안 본다', () => {
  const r = reconcilePositions([], [A()])
  assert.equal(r.match, false)
  assert.equal(r.match === false && r.mismatches[0].kind, 'unknown_in_account')
})

test('방향이 다르면 어긋남이다', () => {
  const r = reconcilePositions([E({ direction: 'long' })], [A({ direction: 'short' })])
  assert.equal(r.match === false && r.mismatches[0].kind, 'direction_differs')
})

test('수량이 다르면 어긋남이다 — 1장 예상에 2장이 있어도', () => {
  const r = reconcilePositions([E({ quantity: 1 })], [A({ quantity: 2 })])
  assert.equal(r.match === false && r.mismatches[0].kind, 'quantity_differs')
})

test('★ 계좌가 방향을 안 주면 맞다고 안 본다', () => {
  const r = reconcilePositions([E()], [A({ direction: null })])
  assert.equal(r.match === false && r.mismatches[0].kind, 'direction_unknown')
})

test('★ 어긋난 것을 전부 준다 — 하나만 주면 고치고 다시 걸리고를 반복한다', () => {
  const r = reconcilePositions(
    [E({ contractCode: 'a' }), E({ contractCode: 'b', quantity: 1 })],
    [A({ contractCode: 'b', quantity: 3 }), A({ contractCode: 'c' })],
  )
  assert.equal(r.match, false)
  const kinds = r.match === false ? r.mismatches.map((m) => m.kind).sort() : []
  assert.deepEqual(kinds, ['missing_in_account', 'quantity_differs', 'unknown_in_account'])
})

test('어긋남마다 사람이 읽을 문장과 기대·실제가 있다', () => {
  const r = reconcilePositions([E({ quantity: 1 })], [A({ quantity: 2 })])
  const m = r.match === false ? r.mismatches[0] : null
  assert.ok(m)
  assert.equal(m.expected, '매수 1장')
  assert.equal(m.actual, '매수 2장')
  assert.ok(m.userMessage.includes('101W12'))
})

// ── 잠금 (SG-04) ─────────────────────────────────────────

test('★ 어떤 어긋남이든 같은 자리로 간다', () => {
  for (const current of POSITION_STATES) {
    const r = reconcilePositions([E()], [A({ quantity: 9 })])
    assert.equal(stateAfterReconcile(current, r), 'reconciliation_required', current)
  }
})

test('★ 맞으면 상태를 안 건드린다 — null 은 「그대로」다', () => {
  assert.equal(stateAfterReconcile('holding', { match: true }), null)
})

test('★ 대조 함수가 잠그기만 하고 절대 안 푼다 (가드)', () => {
  const src = readFileSync(join(HERE, 'reconcile.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  // 푸는 상태 이름이 코드에 등장하지 않는다
  for (const s of ['flat', 'holding', 'entry_pending', 'exit_pending'] as PositionState[]) {
    assert.equal(new RegExp(`'${s}'`).test(src), false, `대조 코드가 ${s} 를 돌려줄 수 있다`)
  }
  // 푸는 사건도 안 부른다
  assert.equal(/mismatch_resolved|nextState/.test(src), false, '대조 코드가 상태를 스스로 옮긴다')
})

test('★ 풀리는 길은 사람 확인 하나뿐이다 (상태 표로 확인)', () => {
  assert.equal(canTransition('reconciliation_required', 'mismatch_resolved'), true)
  assert.equal(canTransition('reconciliation_required', 'exit_filled'), false)
  assert.equal(canTransition('reconciliation_required', 'entry_filled'), false)
})

test('잠금 사유에 무엇이 어느 종목에서 어긋났는지가 남는다', () => {
  const r = reconcilePositions([E({ quantity: 1 })], [A({ quantity: 2 })])
  assert.equal(lockReason(r), 'SG-04:quantity_differs@101W12')
  assert.equal(lockReason({ match: true }), null)
})

test('사유가 길어도 잘려서 기록을 안 막는다', () => {
  const many = Array.from({ length: 60 }, (_, i) => E({ contractCode: `code${i}` }))
  const reason = lockReason(reconcilePositions(many, []))
  assert.ok(reason && reason.length <= 300)
})

test('어긋남 종류가 전부 문장을 가진다', () => {
  const seen = new Set<string>()
  const cases: [ExpectedPosition[], ActualPosition[]][] = [
    [[E()], []],
    [[], [A()]],
    [[E({ direction: 'long' })], [A({ direction: 'short' })]],
    [[E({ quantity: 1 })], [A({ quantity: 2 })]],
    [[E()], [A({ direction: null })]],
  ]
  for (const [e, a] of cases) {
    const r = reconcilePositions(e, a)
    if (r.match) continue
    for (const m of r.mismatches) {
      seen.add(m.kind)
      assert.ok(m.userMessage.length > 0, `${m.kind} 에 문장이 없다`)
    }
  }
  assert.deepEqual([...seen].sort(), [...MISMATCH_KINDS].sort())
})

// ── 조회 실패에서 복구 (§10) ──────────────────────────────

test('★ 끊겼다 돌아오면 재개 전에 한 번 대조한다', () => {
  assert.deepEqual(
    afterBrokerRecovery({ wasFailing: true, nowOk: true, reconciledSinceRecovery: false }),
    { action: 'reconcile_once', reason: 'recovered_from_failure' })
})

test('한 번 대조했으면 또 안 한다', () => {
  assert.deepEqual(
    afterBrokerRecovery({ wasFailing: true, nowOk: true, reconciledSinceRecovery: true }),
    { action: 'continue' })
})

test('아직 조회가 안 되면 막힌 채로 둔다', () => {
  assert.deepEqual(
    afterBrokerRecovery({ wasFailing: true, nowOk: false, reconciledSinceRecovery: false }),
    { action: 'stay_blocked', reason: 'still_failing' })
})

test('끊긴 적이 없으면 그냥 간다', () => {
  assert.deepEqual(
    afterBrokerRecovery({ wasFailing: false, nowOk: true, reconciledSinceRecovery: false }),
    { action: 'continue' })
})
