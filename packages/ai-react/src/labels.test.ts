import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_LABEL_KEYS, missingLabels, type AiLabels } from './labels.ts'

// Object.fromEntries widens to an index signature, which does not overlap a closed interface
const FULL: AiLabels = Object.fromEntries(AI_LABEL_KEYS.map((k) => [k, `x-${k}`])) as unknown as AiLabels

test('a caller that supplies nothing is missing everything', () => {
  assert.deepEqual(missingLabels(null), [...AI_LABEL_KEYS])
  assert.deepEqual(missingLabels(undefined), [...AI_LABEL_KEYS])
  assert.deepEqual(missingLabels({}), [...AI_LABEL_KEYS])
})

test('a complete set is missing nothing', () => {
  assert.deepEqual(missingLabels(FULL), [])
})

test('an empty string is missing, not supplied', () => {
  assert.deepEqual(missingLabels({ ...FULL, generated: '' }), ['generated'])
})

test('there is no default wording anywhere in this package', () => {
  // A default would ship English into a localized product quietly, and a user would notice first
  assert.ok(AI_LABEL_KEYS.length > 0)
  for (const k of AI_LABEL_KEYS) {
    assert.equal(missingLabels({ ...FULL, [k]: undefined } as Partial<AiLabels>).length, 1)
  }
})
