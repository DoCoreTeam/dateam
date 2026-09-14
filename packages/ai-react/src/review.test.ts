import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canConfirmCandidates, confirmBlockedReason, diffRows, decidableRows,
  correctionTrail, wasCorrected, canOfferSettle, type Candidate,
} from './review.ts'

const cand = (id: string, chosen: boolean): Candidate => ({ id, value: id, confidence: 0.5, chosen })

test('extraction cannot be confirmed until a person chooses', () => {
  assert.equal(canConfirmCandidates([cand('a', false), cand('b', false)]), false)
  assert.equal(canConfirmCandidates([cand('a', false), cand('b', true)]), true)
  assert.equal(canConfirmCandidates([]), false, 'nothing to choose is not the same as chosen')
})

test('being blocked comes with a reason a screen can say out loud', () => {
  assert.equal(confirmBlockedReason([cand('a', false)]), 'none_chosen')
  assert.equal(confirmBlockedReason([cand('a', true)]), null)
})

test('a suggestion is always shown beside what it would replace', () => {
  const rows = diffRows({ amount: 100, title: 'x' }, { amount: 200, title: 'x' })
  const amount = rows.find((r) => r.field === 'amount')
  assert.ok(amount)
  assert.equal(amount.current, 100)
  assert.equal(amount.suggested, 200)
  assert.equal(amount.same, false)
})

test('rows that agree are kept and marked, not dropped', () => {
  const rows = diffRows({ a: 1, b: 2 }, { a: 1, b: 3 })
  assert.equal(rows.length, 2, 'unchanged is information too')
  assert.equal(rows.find((r) => r.field === 'a')?.same, true)
  assert.deepEqual(decidableRows(rows).map((r) => r.field), ['b'])
})

test('a field only one side has still becomes a row', () => {
  const rows = diffRows({ a: 1 } as Record<string, number>, { b: 2 } as Record<string, number>)
  assert.deepEqual(rows.map((r) => r.field), ['a', 'b'])
  assert.equal(rows.every((r) => !r.same), true)
})

test('a correction keeps what it replaced, newest first', () => {
  const trail = correctionTrail([
    { at: '2026-09-01T00:00:00.000Z', by: 'u1', from: '"a"', to: '"b"' },
    { at: '2026-09-03T00:00:00.000Z', by: 'u2', from: '"b"', to: '"c"', note: 'n' },
  ])
  assert.deepEqual(trail.map((t) => t.by), ['u2', 'u1'])
  assert.equal(trail[1].from, '"a"', 'the replaced value is still there')
})

test('a value a person touched says so', () => {
  assert.equal(wasCorrected({ corrections: [], status: 'candidate' }), false)
  assert.equal(wasCorrected({ corrections: [], status: 'corrected' }), true)
  assert.equal(wasCorrected({
    corrections: [{ at: 'x', by: 'u', from: 'a', to: 'b' }], status: 'candidate',
  }), true)
})

test('the screen reuses the contract state machine instead of restating it', () => {
  assert.equal(canOfferSettle('streaming', 'confirmed'), false)
  assert.equal(canOfferSettle('candidate', 'confirmed'), true)
  assert.equal(canOfferSettle('confirmed', 'candidate'), false)
})
