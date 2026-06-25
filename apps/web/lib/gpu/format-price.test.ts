import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtKRW, fmtUSD, fmtUSDWhole, fmtMoneyFromOriginal } from './format-price.ts'

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

test('fmtUSD — 최소 2자리(센트) 유지 + 달러 기호', () => {
  assert.equal(fmtUSD(3.24), '$3.24')
  assert.equal(fmtUSD(1234.5), '$1,234.50')
  assert.equal(fmtUSD(0), '$0.00')
})

test('fmtUSD — 무한소수는 셋째 자리에서 올림(ceil), 최대 3자리', () => {
  // 사용자 원성: 0.81018518… 같은 raw 정밀도 노출 차단
  assert.equal(fmtUSD(0.81018518518), '$0.811')   // 0.810185… → 올림 0.811
  assert.equal(fmtUSD(0.92592592592), '$0.926')   // 0.925925… → 0.926
  assert.equal(fmtUSD(2.7546296296), '$2.755')    // 2.75462… → 2.755
  assert.equal(fmtUSD(1.0578703703), '$1.058')
  // 셋째 자리에 떨어지면 그대로(올림 영향 없음)
  assert.equal(fmtUSD(3.24), '$3.24')
  assert.equal(fmtUSD(3.245), '$3.245')
  // 이미 3자리 이하면 올림으로 값이 커지지 않음
  assert.equal(fmtUSD(0.5), '$0.50')
})

test('fmtUSDWhole — 총액은 소수 없이 올림 + 천단위', () => {
  assert.equal(fmtUSDWhole(518400), '$518,400')
  assert.equal(fmtUSDWhole(518400.3), '$518,401') // 올림
  assert.equal(fmtUSDWhole(720), '$720')
  assert.equal(fmtUSDWhole(null), '—')
  assert.equal(fmtUSDWhole(NaN), '—')
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

// ── fmtMoneyFromOriginal — 행별 원본통화 기준(일치=원본 그대로, 불일치=환산) ──
const KRW = 1500
test('KRW 행 + 원 보기 → 원본 원 그대로(환산 round-trip 손실 없음)', () => {
  assert.equal(fmtMoneyFromOriginal('KRW', 3000, 2, 'KRW', KRW), fmtKRW(3000))
})
test('KRW 행 + 달러 보기 → 원본 원을 fx로 USD 환산', () => {
  assert.equal(fmtMoneyFromOriginal('KRW', 3000, 2, 'USD', KRW), fmtUSD(3000 / KRW))
})
test('USD 행 + 달러 보기 → 원본 달러 그대로', () => {
  assert.equal(fmtMoneyFromOriginal('USD', 1.8, 1.8, 'USD', KRW), fmtUSD(1.8))
})
test('USD 행 + 원 보기 → 원본 달러를 fx로 KRW 환산', () => {
  assert.equal(fmtMoneyFromOriginal('USD', 1.8, 1.8, 'KRW', KRW), fmtKRW(1.8 * KRW))
})
test('원본통화 미상(null·기존행) → USD 가정, price_usd 사용', () => {
  assert.equal(fmtMoneyFromOriginal(null, null, 2.5, 'USD', KRW), fmtUSD(2.5))
  assert.equal(fmtMoneyFromOriginal(null, null, 2.5, 'KRW', KRW), fmtKRW(2.5 * KRW))
})
