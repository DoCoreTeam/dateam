import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiryState } from './expiry.ts'

// 기준 시각 고정(결정적): 2026-06-13T00:00:00Z
const NOW = Date.UTC(2026, 5, 13, 0, 0, 0)

test('없음/파싱불가 → none', () => {
  assert.deepEqual(expiryState(null, NOW), { kind: 'none', days: null })
  assert.deepEqual(expiryState('not-a-date', NOW), { kind: 'none', days: null })
})

test('지난 날짜 → expired(음수 일수)', () => {
  const s = expiryState('2026-06-01', NOW)
  assert.equal(s.kind, 'expired')
  assert.ok((s.days ?? 0) < 0)
})

test('7일 이내 → soon', () => {
  assert.equal(expiryState('2026-06-18', NOW).kind, 'soon') // D-5
  assert.equal(expiryState('2026-06-20', NOW).kind, 'soon') // D-7 경계
})

test('7일 초과 → ok', () => {
  assert.equal(expiryState('2026-06-30', NOW).kind, 'ok')
})

test('오늘 만료(D-0) → soon', () => {
  assert.equal(expiryState('2026-06-13', NOW).kind, 'soon')
})
