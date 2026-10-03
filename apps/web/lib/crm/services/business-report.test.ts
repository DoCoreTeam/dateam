import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recognitionSchedule, buildBusinessReport } from './business-report.ts'

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

/*
  기간 축 시험 셋은 `domain/report-axis.test.ts` 로 옮겼다. 이 파일은 집계 서비스를
  보는 자리이고, 기간 경계는 축 모듈의 일이다. 옮기면서 반기와 지난 기간이 더해졌다.
*/

// ------------------------------------------------------------
// 기간 비교 — 같은 자로 두 번 재는가
// ------------------------------------------------------------

/**
 * 가짜 DB. **읽은 횟수를 센다.**
 *
 * 비교를 켜면 창구가 딜을 두 번 읽고 싶어진다. 그러면 두 숫자가 다른 시점의 것이 되고,
 * 그 사이에 딜 하나가 성사되면 비교가 조용히 틀린다. 그래서 횟수를 센다.
 */
function fakeDb(deals: Record<string, unknown>[]) {
  const reads = { deal: 0, pipeline: 0, member: 0, bizType: 0 }
  return {
    reads,
    db: {
      crmDeal: { findMany: async () => { reads.deal += 1; return deals } },
      crmPipeline: { findMany: async () => { reads.pipeline += 1; return [] } },
      crmMember: { findMany: async () => { reads.member += 1; return [] } },
      crmBusinessTypeOption: { findMany: async () => { reads.bizType += 1; return [] } },
    },
  }
}

function wonDeal(id: string, wonAt: string, currency: string, minor: string) {
  return {
    id, name: `딜 ${id}`, status: 'WON', currency,
    amountMinor: null, budgetNetMinor: null, quotedNetMinor: null,
    contractNetMinor: BigInt(minor), bookedNetMinor: null, inKindTotalMinor: null,
    // 기간을 안 적으면 따낸 달에 전액 잡힌다 — 단발 납품과 같은 모양이다
    startDate: null, endDate: null, endDateUnknown: false, termMonths: null,
    businessType: null, businessTypeKey: null,
    wonAt: d(wonAt), ownerId: null, pipelineId: null, stageId: null, company: null,
  }
}

const RANGE_2026Q1 = { from: '2026-01-01', to: '2026-03-31', label: '2026년 1분기' }
const RANGE_2025Q4 = { from: '2025-10-01', to: '2025-12-31', label: '2025년 4분기' }
const RANGE_2024Q1 = { from: '2024-01-01', to: '2024-03-31', label: '2024년 1분기' }

test('★ 비교를 켜도 딜을 한 번만 읽는다', async () => {
  const { db, reads } = fakeDb([
    wonDeal('a', '2026-02-10', 'KRW', '300000000'),
    wonDeal('b', '2025-11-20', 'KRW', '200000000'),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await buildBusinessReport(db as any, {
    period: RANGE_2026Q1, groupBy: 'BUSINESS_TYPE', compare: RANGE_2025Q4,
  })
  assert.equal(reads.deal, 1, '비교 때문에 딜을 두 번 읽으면 두 숫자가 다른 시점의 것이 된다')
  assert.equal(r.comparison?.period.label, '2025년 4분기')
  assert.equal(r.bookings[0].totalMinor, '300000000')
  assert.equal(r.comparison?.bookings[0].totalMinor, '200000000')
})

test('★ 비교 기간에 값이 없으면 빈 묶음이지 0 줄이 아니다', async () => {
  const { db } = fakeDb([wonDeal('a', '2026-02-10', 'KRW', '300000000')])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await buildBusinessReport(db as any, {
    period: RANGE_2026Q1, groupBy: 'BUSINESS_TYPE', compare: RANGE_2024Q1,
  })
  assert.deepEqual(r.comparison?.bookings, [], '0원 줄을 만들면 화면이 「0% 변화」를 그린다')
  assert.equal(r.comparison?.bookingsCount, 0)
})

test('비교를 안 하면 comparison 이 null 이다', async () => {
  const { db } = fakeDb([wonDeal('a', '2026-02-10', 'KRW', '1')])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await buildBusinessReport(db as any, { period: RANGE_2026Q1, groupBy: 'BUSINESS_TYPE' })
  assert.equal(r.comparison, null)
})

test('★ 비교도 통화별로 센다', async () => {
  const { db } = fakeDb([
    wonDeal('a', '2026-02-10', 'KRW', '300000000'),
    wonDeal('b', '2026-02-11', 'USD', '20000'),
    wonDeal('c', '2025-11-20', 'KRW', '200000000'),
    wonDeal('d', '2025-11-21', 'USD', '40000'),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await buildBusinessReport(db as any, {
    period: RANGE_2026Q1, groupBy: 'BUSINESS_TYPE', compare: RANGE_2025Q4,
  })
  const cmp = r.comparison!.bookings
  assert.equal(cmp.length, 2, '통화 수만큼 줄이 나온다')
  assert.ok(!cmp.some((x) => x.currency === 'TOTAL'), '합계 줄을 만들면 누군가 그 숫자를 보고서에 쓴다')
  assert.equal(cmp.find((x) => x.currency === 'KRW')?.totalMinor, '200000000')
  assert.equal(cmp.find((x) => x.currency === 'USD')?.totalMinor, '40000')
})

test('★ 두 기간을 같은 자로 잰다 — 같은 범위를 주면 같은 숫자가 나온다', async () => {
  /*
    금액 셈이 두 벌이면 한쪽만 고쳐진다. 그래서 같은 범위를 비교로 주고
    본 기간과 글자 하나까지 같은지 본다. 어긋나면 셈이 갈라진 것이다.
  */
  const { db } = fakeDb([
    wonDeal('a', '2026-02-10', 'KRW', '300000000'),
    wonDeal('b', '2026-03-01', 'USD', '12345'),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await buildBusinessReport(db as any, {
    period: RANGE_2026Q1, groupBy: 'BUSINESS_TYPE', compare: RANGE_2026Q1,
  })
  assert.deepEqual(r.comparison?.bookings, r.bookings)
  assert.deepEqual(r.comparison?.recognized, r.recognized)
  assert.deepEqual(r.comparison?.cash, r.cash)
  assert.deepEqual(r.comparison?.backlog, r.backlog)
  assert.equal(r.comparison?.bookingsCount, r.bookingsCount)
})
