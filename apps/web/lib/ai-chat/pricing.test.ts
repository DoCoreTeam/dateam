import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateCostUsd, PRICE_PER_MTOK } from './pricing.ts'

test('등록 모델: claude-opus-4-8 정확 계산', () => {
  // in=5, out=25 per MTok. 1M in + 1M out = 5 + 25 = 30
  assert.equal(estimateCostUsd('claude-opus-4-8', 1_000_000, 1_000_000), 30)
  // 500k in + 200k out = 2.5 + 5 = 7.5
  assert.equal(estimateCostUsd('claude-opus-4-8', 500_000, 200_000), 7.5)
})

test('등록 모델: claude-fable-5 (in=10,out=50)', () => {
  assert.equal(estimateCostUsd('claude-fable-5', 1_000_000, 1_000_000), 60)
})

test('미등록 모델은 null', () => {
  assert.equal(estimateCostUsd('gpt-9-ultra', 1000, 1000), null)
  assert.equal(estimateCostUsd('', 1000, 1000), null)
})

test('0 토큰은 0 비용', () => {
  assert.equal(estimateCostUsd('claude-opus-4-8', 0, 0), 0)
})

test('음수/NaN 토큰 방어(0으로 클램프)', () => {
  assert.equal(estimateCostUsd('claude-opus-4-8', -100, -100), 0)
  assert.equal(estimateCostUsd('claude-opus-4-8', NaN, NaN), 0)
})

test('단가표에 gemini/openai 상위 모델 포함', () => {
  assert.ok(PRICE_PER_MTOK['gemini-2.0-flash'])
  assert.ok(PRICE_PER_MTOK['gpt-4o'])
  assert.ok(PRICE_PER_MTOK['claude-opus-4-8'])
})
