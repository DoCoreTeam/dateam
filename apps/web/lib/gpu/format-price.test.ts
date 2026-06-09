import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtKRW, fmtUSD } from './format-price.ts'

// ── fmtKRW ────────────────────────────────────────────────────────────────────

test('fmtKRW — 정수 반올림 + 천단위', () => {
  assert.equal(fmtKRW(1234567), '₩1,234,567')
  assert.equal(fmtKRW(1234567.8), '₩1,234,568')  // 반올림
  assert.equal(fmtKRW(0), '₩0')
})

test('fmtKRW — 소수 반올림', () => {
  assert.equal(fmtKRW(42.4), '₩42')
  assert.equal(fmtKRW(42.5), '₩43')
})

test('fmtKRW — null/undefined/NaN → 대시', () => {
  assert.equal(fmtKRW(null), '—')
  assert.equal(fmtKRW(undefined), '—')
  assert.equal(fmtKRW(NaN), '—')
  assert.equal(fmtKRW(Infinity), '—')
})

// ── fmtUSD ────────────────────────────────────────────────────────────────────

test('fmtUSD — 소수 2자리 고정 + 달러 기호', () => {
  assert.equal(fmtUSD(3.24), '$3.24')
  assert.equal(fmtUSD(1234.5), '$1,234.50')
  assert.equal(fmtUSD(0), '$0.00')
})

test('fmtUSD — 소수 2자리 이상은 반올림(en-US)', () => {
  // toLocaleString 은 3자리에서 반올림
  const result = fmtUSD(3.245)
  assert.ok(result.startsWith('$3.2'), `expected $3.2x, got ${result}`)
})

test('fmtUSD — null/undefined/NaN → 대시', () => {
  assert.equal(fmtUSD(null), '—')
  assert.equal(fmtUSD(undefined), '—')
  assert.equal(fmtUSD(NaN), '—')
  assert.equal(fmtUSD(Infinity), '—')
})

test('fmtUSD — 천단위 구분', () => {
  assert.equal(fmtUSD(10000), '$10,000.00')
})
