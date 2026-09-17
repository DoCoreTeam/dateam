import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  confidenceView, confidencePercentView, statusText, isSettled, sourceView, evidenceView, evidenceSpan,
  LOW_CONFIDENCE_BELOW,
} from './value.ts'
import { AI_LABEL_KEYS, type AiLabels } from './labels.ts'

const L: AiLabels = Object.fromEntries(AI_LABEL_KEYS.map((k) => [k, `x-${k}`])) as AiLabels

test('no confidence and zero confidence are different facts', () => {
  const none = confidenceView(null, L)
  const zero = confidenceView(0, L)
  assert.equal(none.kind, 'unknown')
  assert.equal(zero.kind, 'known')
  assert.notEqual(none.text, zero.text)
})

test('confidence reads as a percent and flags the low ones', () => {
  const high = confidenceView(0.92, L)
  const low = confidenceView(0.4, L)
  assert.deepEqual(high, { kind: 'known', percent: 92, text: '92%', low: false })
  assert.equal(low.kind === 'known' && low.low, true)
})

test('the low threshold is a presentation line, nothing is dropped below it', () => {
  const justBelow = confidenceView(LOW_CONFIDENCE_BELOW - 0.01, L)
  const justAt = confidenceView(LOW_CONFIDENCE_BELOW, L)
  assert.equal(justBelow.kind === 'known' && justBelow.low, true)
  assert.equal(justAt.kind === 'known' && justAt.low, false)
  assert.equal(justBelow.kind, 'known', 'a low value is still shown')
})

test('a confidence outside 0 to 1 is clamped, not rejected', () => {
  assert.equal(confidenceView(1.4, L).kind === 'known' && confidenceView(1.4, L).percent, 100)
  assert.equal(confidenceView(-3, L).kind === 'known' && confidenceView(-3, L).percent, 0)
})

test('every status has a word, and the caller owns every word', () => {
  for (const s of ['streaming', 'candidate', 'confirmed', 'corrected'] as const) {
    const t = statusText(s, L)
    assert.ok(t.startsWith('x-'), `the word for ${s} did not come from the labels`)
  }
})

test('a value still arriving does not read as settled', () => {
  assert.equal(isSettled('streaming'), false)
  assert.equal(isSettled('candidate'), false)
  assert.equal(isSettled('confirmed'), true)
  assert.equal(isSettled('corrected'), true)
})

test('no evidence is stated, not left blank', () => {
  const none = evidenceView([], L)
  const missing = evidenceView(null, L)
  assert.equal(none.empty, true)
  assert.equal(missing.empty, true)
  assert.equal(none.text, L.noEvidence)
  assert.notEqual(none.text, '', 'a blank area reads as evidence not being needed')
})

test('evidence points at a block and a character span', () => {
  const v = evidenceView([{ blockId: 'b12', start: 40, end: 42 }], L)
  assert.equal(v.empty, false)
  assert.equal(v.items.length, 1)
  assert.equal(evidenceSpan(v.items[0]), 'b12 40-42')
})

test('the source says who and when', () => {
  const s = sourceView({ providerId: 'gemini', modelId: 'm-1', at: '2026-09-14T00:00:00.000Z' })
  assert.match(s.text, /gemini/)
  assert.match(s.text, /m-1/)
  assert.equal(s.at, '2026-09-14T00:00:00.000Z')
})

test('a caller may bring its own line without changing how confidence is presented', () => {
  const shipped = confidenceView(0.65, L, 0.6)
  const stricter = confidenceView(0.65, L, 0.7)
  assert.equal(shipped.kind === 'known' && shipped.low, false)
  assert.equal(stricter.kind === 'known' && stricter.low, true)
  assert.equal(shipped.kind === 'known' && shipped.text, '65%', 'the number shown does not move')
})

test('a percentage keeps the number the caller already has', () => {
  // A migration that rounds 73.5 to 74 cannot be told apart from the model changing its mind
  assert.equal(confidencePercentView(73.5, L).text, '73.5%')
  assert.equal(confidencePercentView(80, L).text, '80%')
})

test('a missing percentage says nothing rather than zero', () => {
  const v = confidencePercentView(null, L)
  assert.equal(v.kind, 'unknown')
  assert.equal(v.text, L.confidenceUnknown)
})

test('the percentage threshold is on the same scale as the input', () => {
  // A threshold on a different scale than the value is a silent always-true or always-false
  assert.equal(confidencePercentView(65, L, 70).low, true)
  assert.equal(confidencePercentView(75, L, 70).low, false)
})

test('both entry points agree on the same value', () => {
  assert.equal(confidencePercentView(60, L).low, confidenceView(0.6, L).low)
  assert.equal(confidencePercentView(60, L).percent, confidenceView(0.6, L).percent)
})

test('out-of-range percentages are clamped, not drawn', () => {
  assert.equal(confidencePercentView(140, L).text, '100%')
  assert.equal(confidencePercentView(-5, L).text, '0%')
})
