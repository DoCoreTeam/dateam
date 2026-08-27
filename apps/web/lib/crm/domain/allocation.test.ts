import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateByMonth, allocateByYear, monthSpan, sumByYear } from './allocation.ts'

test('monthSpan — 양 끝을 포함해 센다', () => {
  assert.equal(monthSpan('2026-03-01', '2028-02-29'), 24)
  assert.equal(monthSpan('2026-01-01', '2026-01-31'), 1)
  assert.equal(monthSpan('2026-01-01', '2026-12-31'), 12)
  // 종료가 시작보다 앞서면 1로 접는다 — 0으로 나누지 않기 위해서다
  assert.equal(monthSpan('2026-06-01', '2026-01-01'), 1)
})

test('연차 배분 — 기획서 §05 ⑧ 의 실례가 그대로 나온다', () => {
  const y = allocateByYear(180_000_000n, '2026-03-01', '2028-02-29')
  assert.deepEqual(y, [
    { year: 2026, months: 10, amountMinor: 75_000_000n },
    { year: 2027, months: 12, amountMinor: 90_000_000n },
    { year: 2028, months: 2, amountMinor: 15_000_000n },
  ])
  assert.equal(y.reduce((a, b) => a + b.amountMinor, 0n), 180_000_000n)
})

test('나눠떨어지지 않아도 합은 정확하다 (I7)', () => {
  for (const amount of [100n, 1n, 7n, 999_999_999n, 1_300_000_000n]) {
    const y = allocateByYear(amount, '2026-03-01', '2028-02-29')
    assert.equal(y.reduce((a, b) => a + b.amountMinor, 0n), amount, `${amount}`)
  }
})

test('월 배분 — 개수와 연·월이 맞다', () => {
  const m = allocateByMonth(1_200n, '2026-11-01', '2027-02-28')
  assert.equal(m.length, 4)
  assert.deepEqual(m.map((x) => `${x.year}-${x.month}`), ['2026-11', '2026-12', '2027-1', '2027-2'])
  assert.equal(m.reduce((a, b) => a + b.amountMinor, 0n), 1_200n)
  assert.ok(m.every((x) => x.amountMinor === 300n))
})

test('잔차는 앞쪽 달이 먼저 받는다 — 다시 계산해도 같은 답', () => {
  const a = allocateByMonth(10n, '2026-01-01', '2026-03-31')
  const b = allocateByMonth(10n, '2026-01-01', '2026-03-31')
  assert.deepEqual(a, b)
  assert.deepEqual(a.map((x) => x.amountMinor), [4n, 3n, 3n])
})

test('한 달짜리 · 0원도 안전하다', () => {
  assert.deepEqual(allocateByYear(5_000n, '2026-05-10', '2026-05-20'),
    [{ year: 2026, months: 1, amountMinor: 5_000n }])
  const z = allocateByYear(0n, '2026-01-01', '2026-12-31')
  assert.equal(z.reduce((a, b) => a + b.amountMinor, 0n), 0n)
})

test('Date 객체도 받는다', () => {
  const y = allocateByYear(1_000n, new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'))
  assert.equal(y.length, 1)
  assert.equal(y[0].amountMinor, 1_000n)
})

test('sumByYear — 현물 명세 3건의 연차 합계', () => {
  const r = sumByYear([
    { amountMinor: 180_000_000n, startDate: '2026-03-01', endDate: '2028-02-29' },
    { amountMinor: 60_000_000n, startDate: '2026-03-01', endDate: '2028-02-29' },
    { amountMinor: 20_000_000n, startDate: '2026-01-01', endDate: '2028-12-31' },
  ])
  assert.equal(r.undatedMinor, 0n)
  assert.equal(r.years.reduce((a, b) => a + b.amountMinor, 0n), 260_000_000n)
  const y2027 = r.years.find((y) => y.year === 2027)
  assert.ok(y2027 && y2027.amountMinor > 0n)
})

test('기간이 없는 항목은 배분하지 않고 따로 센다 — 0으로 때우지 않는다', () => {
  const r = sumByYear([
    { amountMinor: 100n, startDate: '2026-01-01', endDate: '2026-12-31' },
    { amountMinor: 900n },                                  // 기간 없음
    { amountMinor: 50n, startDate: '2026-01-01' },           // 종료 없음
  ])
  assert.equal(r.undatedMinor, 950n)
  assert.equal(r.years.reduce((a, b) => a + b.amountMinor, 0n), 100n)
})

test('sumByYear — 빈 목록', () => {
  const r = sumByYear([])
  assert.deepEqual(r.years, [])
  assert.equal(r.undatedMinor, 0n)
})
