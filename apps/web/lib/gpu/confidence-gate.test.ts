import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyConfidence, partitionByConfidence, bandLabel } from './confidence-gate.ts'

test('경계값: 90=auto, 89.9=review, 70=review, 69.9=block', () => {
  assert.equal(classifyConfidence(90), 'auto')
  assert.equal(classifyConfidence(89.9), 'review')
  assert.equal(classifyConfidence(70), 'review')
  assert.equal(classifyConfidence(69.9), 'block')
})

test('범위 밖 입력 클램프', () => {
  assert.equal(classifyConfidence(200), 'auto')
  assert.equal(classifyConfidence(-5), 'block')
  assert.equal(classifyConfidence(NaN), 'block')
})

test('partition: 3구간 분할', () => {
  const items = [
    { confidence: 92 }, { confidence: 95 },
    { confidence: 74 },
    { confidence: 50 },
  ]
  const p = partitionByConfidence(items)
  assert.equal(p.auto.length, 2)
  assert.equal(p.review.length, 1)
  assert.equal(p.block.length, 1)
})

test('partition: 입력 불변', () => {
  const items = [{ confidence: 92 }]
  const p = partitionByConfidence(items)
  assert.equal(items.length, 1)
  assert.notEqual(p.auto, items)
})

test('bandLabel', () => {
  assert.equal(bandLabel('auto'), '자동 확정 후보')
  assert.equal(bandLabel('review'), '검토 필요')
  assert.equal(bandLabel('block'), '차단')
})
