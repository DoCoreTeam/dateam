import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recognitionSchedule } from './business-report.ts'
import { periodRange } from '../domain/report-axis.ts'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

test('기간이 있으면 월할한다 — 5년 계약이 계약한 달에 통째로 잡히지 않는다', () => {
  const { byMonth, unknown } = recognitionSchedule({
    bookedMinor: BigInt(1200),
    startDate: d('2026-01-01'), endDate: d('2026-12-31'),
    endDateUnknown: false, wonAt: d('2025-12-01'),
  })
  assert.equal(unknown, false)
  assert.equal(byMonth.size, 12)
  assert.equal(byMonth.get('2026-01'), BigInt(100))
  assert.equal(byMonth.get('2026-12'), BigInt(100))
  const total = Array.from(byMonth.values()).reduce((a, b) => a + b, BigInt(0))
  assert.equal(total, BigInt(1200), '나눠도 총액은 그대로여야 한다')
})

test('나머지가 있어도 총액은 보존된다 — 잔차가 사라지면 매출이 조용히 줄어든다', () => {
  const { byMonth } = recognitionSchedule({
    bookedMinor: BigInt(1000),
    startDate: d('2026-01-01'), endDate: d('2026-03-31'),
    endDateUnknown: false, wonAt: null,
  })
  const total = Array.from(byMonth.values()).reduce((a, b) => a + b, BigInt(0))
  assert.equal(total, BigInt(1000))
  assert.equal(byMonth.size, 3)
})

test('기간이 없으면 따낸 달에 전액 — 단발 납품이 그렇다', () => {
  const { byMonth, unknown } = recognitionSchedule({
    bookedMinor: BigInt(500),
    startDate: null, endDate: null, endDateUnknown: false, wonAt: d('2026-08-14'),
  })
  assert.equal(unknown, false)
  assert.equal(byMonth.get('2026-08'), BigInt(500))
  assert.equal(byMonth.size, 1)
})

test('종료를 모른다고 표시된 사업은 배분하지 않는다 — 0 으로도 전액으로도 치지 않는다', () => {
  const { byMonth, unknown } = recognitionSchedule({
    bookedMinor: BigInt(900),
    startDate: d('2026-03-01'), endDate: null, endDateUnknown: true, wonAt: d('2026-03-01'),
  })
  assert.equal(unknown, true, '모른다고 말해야 한다')
  assert.equal(byMonth.size, 0, '지어낸 숫자를 넣으면 안 된다')
})

test('따낸 날도 기간도 없으면 모른다 — 아무 달에나 넣지 않는다', () => {
  const { unknown } = recognitionSchedule({
    bookedMinor: BigInt(100), startDate: null, endDate: null, endDateUnknown: false, wonAt: null,
  })
  assert.equal(unknown, true)
})

test('금액이 0이면 배분도 없고 «모름»도 아니다', () => {
  const { byMonth, unknown } = recognitionSchedule({
    bookedMinor: BigInt(0), startDate: null, endDate: null, endDateUnknown: true, wonAt: null,
  })
  assert.equal(byMonth.size, 0)
  assert.equal(unknown, false, '0원짜리를 «기간 모름»으로 세면 경고가 부풀어 오른다')
})

test('기간 축 — 분기는 달력 분기다', () => {
  assert.deepEqual(periodRange('THIS_QUARTER', '2026-08-28'),
    { from: '2026-07-01', to: '2026-09-30', label: '2026년 3분기' })
  assert.deepEqual(periodRange('THIS_QUARTER', '2026-01-15'),
    { from: '2026-01-01', to: '2026-03-31', label: '2026년 1분기' })
})

test('기간 축 — 이번 달은 말일까지, 윤년도 맞는다', () => {
  assert.deepEqual(periodRange('THIS_MONTH', '2026-02-10'),
    { from: '2026-02-01', to: '2026-02-28', label: '이번 달' })
  assert.deepEqual(periodRange('THIS_MONTH', '2028-02-10'),
    { from: '2028-02-01', to: '2028-02-29', label: '이번 달' })
})

test('기간 축 — 최근 12개월은 해를 넘어간다', () => {
  assert.deepEqual(periodRange('LAST_12M', '2026-08-28'),
    { from: '2025-09-01', to: '2026-08-31', label: '최근 12개월' })
})
