import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffExtracted, valuesEqual, normalizeReanalysis } from './extract-diff.ts'

test('값 동등 비교 — 숫자/문자 동일 취급, null 정규화', () => {
  assert.equal(valuesEqual(1, '1'), true)
  assert.equal(valuesEqual(undefined, null), true)
  assert.equal(valuesEqual('H100', 'H100'), true)
  assert.equal(valuesEqual(3.17, 2.91), false)
  assert.equal(valuesEqual(null, 'x'), false)
  assert.equal(valuesEqual({ a: 1 }, { a: 1 }), true)
})

test('변경된 필드만 추출(before/after)', () => {
  const before = { model_name: 'RTX Pro 6000', unit_price_usd: 3.17, term_months: 11 }
  const after = { model_name: 'RTX Pro 6000', unit_price_usd: 2.91, term_months: 11 }
  const d = diffExtracted(before, after)
  assert.equal(d.length, 1)
  assert.equal(d[0].field, 'unit_price_usd')
  assert.equal(d[0].label, '단가 (USD/hr)')
  assert.equal(d[0].before, 3.17)
  assert.equal(d[0].after, 2.91)
})

test('추가/삭제 필드도 변경으로 잡힘', () => {
  const before = { model_name: 'H100' }
  const after = { model_name: 'H100', setup_fee_krw: 500000 }
  const d = diffExtracted(before, after)
  assert.equal(d.length, 1)
  assert.equal(d[0].field, 'setup_fee_krw')
  assert.equal(d[0].before, null)
  assert.equal(d[0].after, 500000)
})

test('무변경 → 빈 배열, original_text 제외', () => {
  const same = { model_name: 'A100', original_text: '긴 원문...' }
  assert.deepEqual(diffExtracted(same, { ...same, original_text: '다른 원문' }), [])
})

test('핵심 필드가 비핵심보다 먼저 정렬', () => {
  const before = { zzz_custom: 'a', unit_price_usd: 1 }
  const after = { zzz_custom: 'b', unit_price_usd: 2 }
  const d = diffExtracted(before, after)
  assert.equal(d[0].field, 'unit_price_usd')
  assert.equal(d[1].field, 'zzz_custom')
})

const FALLBACK = { unit_price_usd: 3.17 }

test('normalizeReanalysis — 단일 {extracted} 중첩 형태', () => {
  const r = normalizeReanalysis({ extracted: { unit_price_usd: 2.91, model_name: 'H100' }, confidence: { unit_price_usd: 98 } }, FALLBACK)
  assert.equal(r.extracted.unit_price_usd, 2.91)
  assert.equal(r.confidence.unit_price_usd, 98)
})

test('normalizeReanalysis — 멀티 {items:[{extracted}]} 형태(실측 Gemini 응답)', () => {
  const r = normalizeReanalysis({
    items: [{ extracted: { unit_price_usd: 2.91, model_name: 'RTX Pro 6000' }, confidence: { unit_price_usd: 98 }, evidence: { unit_price_usd: '환산' } }],
  }, FALLBACK)
  assert.equal(r.extracted.unit_price_usd, 2.91)
  assert.equal(r.extracted.model_name, 'RTX Pro 6000')
  assert.equal(r.confidence.unit_price_usd, 98)
  assert.equal(r.evidence.unit_price_usd, '환산')
})

test('normalizeReanalysis — 평탄 JSON 형태(extracted 래퍼 없음)', () => {
  const r = normalizeReanalysis({ unit_price_usd: 2.91, model_name: 'A100', change_summary: '재산출' }, FALLBACK)
  assert.equal(r.extracted.unit_price_usd, 2.91)
  assert.equal(r.extracted.model_name, 'A100')
  // change_summary는 메타라 extracted에 안 섞임
  assert.equal(r.extracted.change_summary, undefined)
})

test('normalizeReanalysis — 빈 응답이면 fallback 유지(재분석 무시 방지)', () => {
  const r = normalizeReanalysis({ change_summary: '변경 없음' }, FALLBACK)
  assert.equal(r.extracted.unit_price_usd, 3.17)
})
