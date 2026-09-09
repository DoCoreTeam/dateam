import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_CONTRACT_VERSION, newAiValue, versionOf, isAiValue, canTransition, applyCorrection,
  type AiSource, type AiValue,
} from './contract.ts'
import { AI_CAPABILITIES, REQUIRED_PRESENTATION, isAiCapability } from './capability.ts'

const SOURCE: AiSource = { providerId: 'p', modelId: 'm', at: '2026-09-10T00:00:00.000Z' }

test('every capability answers in the same seven-part shape', () => {
  for (const capability of AI_CAPABILITIES) {
    const v = newAiValue({ capability, value: 1, source: SOURCE, status: 'candidate' })
    assert.deepEqual(Object.keys(v).sort(), [
      'capability', 'confidence', 'contractVersion', 'corrections', 'evidence', 'source', 'status', 'value',
    ])
  }
})

test('the eight capabilities are the eight, and each states how it must be shown', () => {
  assert.equal(AI_CAPABILITIES.length, 8)
  for (const c of AI_CAPABILITIES) {
    assert.ok(REQUIRED_PRESENTATION[c].length > 0, `${c} has no required presentation`)
  }
  assert.equal(Object.keys(REQUIRED_PRESENTATION).length, 8)
  assert.ok(isAiCapability('extract'))
  assert.ok(!isAiCapability('translate'))
})

test('a new value is stamped with the current contract version', () => {
  const v = newAiValue({ capability: 'extract', value: 'x', source: SOURCE, status: 'candidate' })
  assert.equal(v.contractVersion, AI_CONTRACT_VERSION)
})

test('a record with no version reads as null, never as version 1', () => {
  assert.equal(versionOf({ capability: 'extract' }), null)
  assert.equal(versionOf({ contractVersion: 0 }), null)
  assert.equal(versionOf({ contractVersion: '1' }), null)
  assert.equal(versionOf(null), null)
  assert.equal(versionOf({ contractVersion: 2 }), 2)
})

test('streaming is a first-class status, not something bolted on later', () => {
  assert.ok(canTransition('streaming', 'streaming'))
  assert.ok(canTransition('streaming', 'candidate'))
  assert.ok(!canTransition('streaming', 'confirmed'), 'a half-arrived value cannot be confirmed')
})

test('status never moves backwards', () => {
  assert.ok(!canTransition('confirmed', 'candidate'))
  assert.ok(!canTransition('corrected', 'confirmed'))
  assert.ok(!canTransition('candidate', 'streaming'))
})

test('a correction keeps what it replaced', () => {
  const v = newAiValue({ capability: 'extract', value: 'old', source: SOURCE, status: 'candidate' })
  const c = applyCorrection(v, 'new', 'user-1', '2026-09-10T01:00:00.000Z', 'wrong figure')
  assert.equal(c.value, 'new')
  assert.equal(c.status, 'corrected')
  assert.equal(c.corrections.length, 1)
  assert.equal(c.corrections[0].from, '"old"')
  assert.equal(c.corrections[0].by, 'user-1')
})

test('a streaming value cannot be corrected', () => {
  const v = newAiValue({ capability: 'generate', value: 'half', source: SOURCE, status: 'streaming' })
  assert.throws(() => applyCorrection(v, 'x', 'u', '2026-09-10T01:00:00.000Z'), /status "streaming"/)
})

test('the shape can be re-asserted after types are erased at a boundary', () => {
  const v = newAiValue({ capability: 'judge', value: true, source: SOURCE, status: 'confirmed' })
  const overTheWire: unknown = JSON.parse(JSON.stringify(v))
  assert.ok(isAiValue(overTheWire))
  assert.ok(!isAiValue({ ...(v as AiValue), contractVersion: undefined }))
  assert.ok(!isAiValue({ ...(v as AiValue), source: null }))
  assert.ok(!isAiValue('a string that a screen was handed'))
})

test('evidence carries a block and a character span', () => {
  const v = newAiValue({
    capability: 'extract', value: '1B', source: SOURCE, status: 'candidate',
    evidence: [{ blockId: 'b12', start: 40, end: 42, quote: '1B' }],
  })
  assert.equal(v.evidence[0].blockId, 'b12')
  assert.equal(v.evidence[0].end - v.evidence[0].start, 2)
})

test('no confidence is null, which is not the same as zero confidence', () => {
  const v = newAiValue({ capability: 'summarize', value: 's', source: SOURCE, status: 'candidate' })
  assert.equal(v.confidence, null)
  const z = newAiValue({ capability: 'summarize', value: 's', source: SOURCE, status: 'candidate', confidence: 0 })
  assert.equal(z.confidence, 0)
})
