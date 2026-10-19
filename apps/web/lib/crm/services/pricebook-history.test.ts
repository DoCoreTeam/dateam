import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valueAt } from './pricebook-history.ts'

const row = (field: string, amount: number, from: string, at = from) => ({
  field, amountMinor: BigInt(amount), effectiveFrom: new Date(`${from}T00:00:00Z`), createdAt: new Date(`${at}T09:00:00Z`),
})

test('★ 1년 뒤에 열어도 같은 답 — 날짜에 따라 다른 값을 읽는다', () => {
  const rows = [row('listPrice', 7_000_000, '2025-01-01'), row('listPrice', 7_300_000, '2026-01-01')]
  assert.equal(valueAt(rows, 'listPrice', new Date('2025-06-30T00:00:00Z')), BigInt(7_000_000))
  assert.equal(valueAt(rows, 'listPrice', new Date('2026-10-20T00:00:00Z')), BigInt(7_300_000))
  assert.equal(valueAt(rows, 'listPrice', new Date('2024-12-31T00:00:00Z')), null)
})

test('같은 날 두 번 고쳤으면 나중 것', () => {
  const rows = [row('listPrice', 1, '2026-01-01', '2026-01-01'), { ...row('listPrice', 2, '2026-01-01'), createdAt: new Date('2026-01-01T10:00:00Z') }]
  assert.equal(valueAt(rows, 'listPrice', new Date('2026-01-01T00:00:00Z')), BigInt(2))
})

test('다른 칸의 값은 섞지 않는다', () => {
  assert.equal(valueAt([row('costPerMm', 5, '2026-01-01')], 'listPrice', new Date()), null)
})
