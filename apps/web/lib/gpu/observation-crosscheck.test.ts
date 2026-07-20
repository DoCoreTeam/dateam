import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossCheck } from './observation-crosscheck.ts'
import type { AiObservation } from './observation-contract.ts'

function obs(overrides: Partial<AiObservation> = {}): AiObservation {
  return {
    competitor_name: 'X', model: 'H100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: 100, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'H100', match_basis: 'exact', provenance: '$100/hr',
    ...overrides,
  }
}

const KRW_PER_USD = 1342.5
const FX = { USD: KRW_PER_USD, JPY: 9.5 }

test('agree: AI and deterministic within 2% tolerance', () => {
  // AI: $100/hr -> KRW 134250/hr
  // det: price_usd such that *krwPerUsd is close
  const det = [{ model_name: 'H100', price_usd: 100.5 }] // 100.5*1342.5 vs 100*1342.5 -> diff ~0.5%
  const results = crossCheck([obs()], det, KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.equal(results[0].agreement, 'agree')
})

test('conflict: AI and deterministic differ beyond 2%', () => {
  const det = [{ model_name: 'H100', price_usd: 150 }] // 50% higher
  const results = crossCheck([obs()], det, KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.equal(results[0].agreement, 'conflict')
  assert.ok(results[0].relativeDiff !== null && results[0].relativeDiff > 0.02)
})

test('ai_only: AI observation with no matching deterministic item', () => {
  const results = crossCheck([obs({ model: 'GB200', catalog_match: 'GB200' })], [], KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.equal(results[0].agreement, 'ai_only')
})

test('det_only: deterministic item with no matching AI observation', () => {
  const det = [{ model_name: 'A100', price_usd: 50 }]
  const results = crossCheck([], det, KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.equal(results[0].agreement, 'det_only')
  assert.equal(results[0].model, 'A100')
})

test('matches by catalog_match when present, falls back to model when catalog_match is null', () => {
  const uncertain = obs({ model: 'HGX B300', catalog_match: null, match_basis: 'none' })
  const det = [{ model_name: 'hgx b300', price_usd: 100 }]
  const results = crossCheck([uncertain], det, KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.notEqual(results[0].agreement, 'ai_only')
})

test('mixed set produces all four agreement categories', () => {
  const aiObs = [
    obs({ model: 'H100', catalog_match: 'H100', amount: 100 }), // will agree
    obs({ model: 'A100', catalog_match: 'A100', amount: 200 }), // will conflict
    obs({ model: 'GB200', catalog_match: 'GB200', amount: 50 }), // ai_only
  ]
  const det = [
    { model_name: 'H100', price_usd: 100.2 },
    { model_name: 'A100', price_usd: 50 },
    { model_name: 'L40S', price_usd: 30 }, // det_only
  ]
  const results = crossCheck(aiObs, det, KRW_PER_USD, FX)
  const byModel = new Map(results.map((r) => [r.model, r.agreement]))
  assert.equal(byModel.get('H100'), 'agree')
  assert.equal(byModel.get('A100'), 'conflict')
  assert.equal(byModel.get('GB200'), 'ai_only')
  assert.equal(byModel.get('L40S'), 'det_only')
})

test('unsupported AI currency yields ai_only (comparison held, not silently dropped)', () => {
  const eurObs = obs({ currency: 'EUR', model: 'H100', catalog_match: 'H100' })
  const det = [{ model_name: 'H100', price_usd: 100 }]
  const results = crossCheck([eurObs], det, KRW_PER_USD, FX)
  assert.equal(results.length, 1)
  assert.equal(results[0].agreement, 'ai_only')
  assert.equal(results[0].aiKrwPerGpuHour, null)
})
