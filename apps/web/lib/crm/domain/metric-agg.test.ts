// lib/crm/domain/metric-agg.test.ts — 엔진 하나가 지표·축을 전부 처리한다
//
// **왜 여기서 다 잡나**: 이 계산이 화면 안에 있으면 실브라우저 말고 검증 수단이
// 없다(완료 조건 E-6). 순수 함수로 빼 두었으니 숫자로 잠근다.
//
// 앵커는 운영 데이터의 실제 딜이다 — 9.00억 × 45% = 4.05억, 13.00억 × 33% = 4.29억.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  aggregate, cellAt, sumOf, bucketOf, timeBucketOf, amountOf, inScope,
  contributionsOf, isTimeAxis, ALL_KEY, EMPTY_KEY, CELL_SEP, DEFAULT_STALLED_DAYS,
  type AggDeal, type QuerySpec,
} from './metric-agg.ts'
import { metricOf } from './metrics.ts'

const 억 = (n: number) => String(n * 100_000_000)

function deal(over: Partial<AggDeal> = {}): AggDeal {
  return {
    id: 'd1', status: 'OPEN',
    createdAtIso: '2026-06-01T00:00:00+09:00',
    wonAtIso: null,
    expectedCloseIso: '2026-10-01T00:00:00+09:00',
    startDateIso: null, endDateIso: null,
    stageEnteredAtIso: '2026-08-01T00:00:00+09:00',
    currency: 'KRW',
    contractNetMinor: null, quotedNetMinor: null, budgetNetMinor: null,
    amountMinor: 억(1),
    winProbabilityPct: 33,
    stage: { id: 'st1', name: '진행 중' },
    pipeline: { id: 'p1', name: '흐름ㄱ' },
    businessType: { id: 'bt1', name: '유형ㄱ' },
    owner: null,
    company: { id: 'c1', name: '고객ㄱ', industry: null, region: null, employeeRange: null, domain: null },
    ...over,
  }
}

const YEAR26 = { kind: 'YEAR' as const, year: 2026 }
const spec = (over: Partial<QuerySpec> = {}): QuerySpec =>
  ({ metric: 'open_pipeline', period: YEAR26, todayKey: '2026-09-09', ...over })

// ── 기본 ────────────────────────────────────────────────
test('축을 안 주면 총합 한 칸이다', () => {
  const r = aggregate([deal({ amountMinor: 억(13) }), deal({ id: 'd2', amountMinor: 억(9) })], spec())
  assert.deepEqual(r.rows, [{ key: ALL_KEY, label: '전체' }])
  assert.equal(sumOf(r.total), BigInt(억(22)))
  assert.equal(r.total.count, 2)
})

test('★ 앵커 — 9.00억 × 45% = 4.05억', () => {
  const r = aggregate([deal({ amountMinor: 억(9), winProbabilityPct: 45 })], spec({ metric: 'weighted' }))
  assert.equal(sumOf(r.total), BigInt('405000000'))
})

test('★ 앵커 — 13.00억 × 33% = 4.29억', () => {
  const r = aggregate([deal({ amountMinor: 억(13), winProbabilityPct: 33 })], spec({ metric: 'weighted' }))
  assert.equal(sumOf(r.total), BigInt('429000000'))
})

test('가중치는 버림이다 — 1원을 만들어내지 않는다', () => {
  const r = aggregate([deal({ amountMinor: '101', winProbabilityPct: 33 })], spec({ metric: 'weighted' }))
  assert.equal(sumOf(r.total), BigInt(33), '101×33/100 = 33.33 → 33')
})

test('★ 확률을 모르는 딜은 가중 예상에서 빠지고, 뺐다고 말한다', () => {
  const r = aggregate([
    deal({ id: 'a', amountMinor: 억(10), winProbabilityPct: 50 }),
    deal({ id: 'b', amountMinor: 억(10), winProbabilityPct: null }),
  ], spec({ metric: 'weighted' }))
  assert.equal(sumOf(r.total), BigInt(억(5)), '확률 없는 10억은 0으로 위장되지 않는다')
  assert.equal(r.notes.unknownProbability, 1)
})

test('확률이 없어도 열린 파이프라인에는 그대로 들어간다', () => {
  const r = aggregate([deal({ amountMinor: 억(10), winProbabilityPct: null })], spec())
  assert.equal(sumOf(r.total), BigInt(억(10)))
  assert.equal(r.notes.unknownProbability, 0)
})

// ── 기간 ────────────────────────────────────────────────
test('★ 기간 밖은 안 센다 · 경계는 양끝 포함이다', () => {
  const q4 = { kind: 'QUARTER' as const, year: 2026, index: 4 }
  const at = (iso: string) => aggregate([deal({ expectedCloseIso: iso, amountMinor: 억(1) })],
    spec({ period: q4 })).total.count
  assert.equal(at('2026-10-01T00:00:00+09:00'), 1, '첫날')
  assert.equal(at('2026-12-31T23:00:00+09:00'), 1, '마지막 날')
  assert.equal(at('2026-09-30T23:00:00+09:00'), 0)
  assert.equal(at('2027-01-01T00:00:00+09:00'), 0)
})

test('★ 경계는 KST 로 판정한다 — UTC 로 자르면 하루가 밀린다', () => {
  // UTC 로는 9월 30일 15:00 이지만 KST 로는 10월 1일 자정이다
  const r = aggregate([deal({ expectedCloseIso: '2026-09-30T15:00:00Z', amountMinor: 억(1) })],
    spec({ period: { kind: 'QUARTER', year: 2026, index: 4 } }))
  assert.equal(r.total.count, 1, 'KST 10월 1일이므로 4분기다')
})

test('★ 지표마다 기준 날짜가 다르다 — 같은 딜이 다른 달에 선다', () => {
  const d = deal({
    status: 'WON',
    wonAtIso: '2026-03-10T00:00:00+09:00',
    expectedCloseIso: '2026-11-01T00:00:00+09:00',
    amountMinor: 억(1),
  })
  const q1 = { kind: 'QUARTER' as const, year: 2026, index: 1 }
  assert.equal(aggregate([d], spec({ metric: 'bookings', period: q1 })).total.count, 1, '수주는 따낸 날')
  assert.equal(aggregate([d], spec({ metric: 'bookings', period: { kind: 'QUARTER', year: 2026, index: 4 } })).total.count, 0)
})

// ── 축 ──────────────────────────────────────────────────
test('행 × 열 교차표를 만든다', () => {
  const r = aggregate([
    deal({ id: 'a', pipeline: { id: 'p1', name: '흐름ㄱ' }, expectedCloseIso: '2026-10-01T00:00:00+09:00', amountMinor: 억(13) }),
    deal({ id: 'b', pipeline: { id: 'p2', name: '흐름ㄴ' }, expectedCloseIso: '2026-08-01T00:00:00+09:00', amountMinor: 억(4) }),
  ], spec({ rows: 'pipeline', cols: 'quarter' }))
  assert.equal(r.rows.length, 2)
  assert.equal(sumOf(cellAt(r, 'p1', '2026Q4')), BigInt(억(13)))
  assert.equal(sumOf(cellAt(r, 'p2', '2026Q3')), BigInt(억(4)))
  assert.equal(sumOf(cellAt(r, 'p1', '2026Q3')), BigInt(0), '빈 칸은 0이지 undefined 가 아니다')
})

test('★ 값이 없는 축은 「없음」 한 줄로 모이고, 칸 합이 총합과 같다', () => {
  const r = aggregate([
    deal({ id: 'a', owner: { id: 'u1', name: '나' }, amountMinor: 억(3) }),
    deal({ id: 'b', owner: null, amountMinor: 억(5) }),
    deal({ id: 'c', owner: null, amountMinor: 억(2) }),
  ], spec({ rows: 'owner' }))
  assert.equal(sumOf(cellAt(r, EMPTY_KEY, ALL_KEY)), BigInt(억(7)), '담당자 없음 두 건이 한 줄로')
  const sum = r.rows.reduce((s, row) => s + sumOf(cellAt(r, row.key, ALL_KEY)), BigInt(0))
  assert.equal(sum, sumOf(r.total), '칸 합이 총합과 달라지면 사람이 그 차이를 영원히 못 찾는다')
})

test('기관 종류 축은 도메인이 판정한다 — AI 를 안 부른다', () => {
  const c = (domain: string | null) => ({ id: 'c', name: 'x', industry: null, region: null, employeeRange: null, domain })
  const r = aggregate([
    deal({ id: 'a', company: c('sookmyung.ac.kr'), amountMinor: 억(1) }),
    deal({ id: 'b', company: c('kicox.or.kr'), amountMinor: 억(2) }),
    deal({ id: 'c', company: c(null), amountMinor: 억(3) }),
  ], spec({ rows: 'companyKind' }))
  assert.equal(sumOf(cellAt(r, 'school', ALL_KEY)), BigInt(억(1)))
  assert.equal(sumOf(cellAt(r, 'public', ALL_KEY)), BigInt(억(2)))
  assert.equal(sumOf(cellAt(r, EMPTY_KEY, ALL_KEY)), BigInt(억(3)))
})

test('시간 칸 이름이 사람이 부르는 말이다', () => {
  assert.deepEqual(timeBucketOf('2026-10-05', 'QUARTER'), { key: '2026Q4', label: '2026 4분기' })
  assert.deepEqual(timeBucketOf('2026-10-05', 'HALF'), { key: '2026H2', label: '2026 하반기' })
  assert.deepEqual(timeBucketOf('2026-03-05', 'MONTH'), { key: '2026-03', label: '3월' })
  assert.deepEqual(timeBucketOf('2026-03-05', 'YEAR'), { key: '2026', label: '2026년' })
})

test('시간 축과 쪼개는 기준을 구분한다', () => {
  assert.equal(isTimeAxis('quarter'), true)
  assert.equal(isTimeAxis('pipeline'), false)
})

// ── 조건 ────────────────────────────────────────────────
test('조건이 걸리면 그 값만 센다', () => {
  const r = aggregate([
    deal({ id: 'a', pipeline: { id: 'p1', name: 'ㄱ' }, amountMinor: 억(3) }),
    deal({ id: 'b', pipeline: { id: 'p2', name: 'ㄴ' }, amountMinor: 억(5) }),
  ], spec({ filters: [{ dimension: 'pipeline', value: 'p1' }] }))
  assert.equal(sumOf(r.total), BigInt(억(3)))
  assert.equal(r.notes.matched, 1)
})

test('기한 지난 딜은 마감일이 오늘보다 앞선 것만이다', () => {
  const at = (iso: string | null) => aggregate([deal({ expectedCloseIso: iso })],
    spec({ metric: 'overdue' })).total.count
  assert.equal(at('2026-09-08T00:00:00+09:00'), 1, '어제')
  assert.equal(at('2026-09-09T00:00:00+09:00'), 0, '오늘은 아직 안 지났다')
  assert.equal(at('2026-10-01T00:00:00+09:00'), 0)
  assert.equal(at(null), 0, '마감일이 없으면 지났다고 말하지 않는다')
})

test('정체 딜은 기준 일수를 넘긴 것만이다', () => {
  const at = (iso: string | null, days?: number) => aggregate([deal({ stageEnteredAtIso: iso })],
    spec({ metric: 'stalled', stalledDays: days })).total.count
  assert.equal(at('2026-08-01T00:00:00+09:00'), 1, '39일')
  assert.equal(at('2026-09-08T00:00:00+09:00'), 0, '하루')
  assert.equal(at('2026-08-01T00:00:00+09:00', 60), 0, '기준을 올리면 빠진다')
  assert.equal(at(null), 0, '진입 시각을 모르면 정체라고 말하지 않는다')
  assert.ok(DEFAULT_STALLED_DAYS > 0)
})

// ── 통화 ────────────────────────────────────────────────
test('★ 통화를 섞지 않는다 — 환산해 한 숫자로 만들면 환율을 아무도 못 댄다', () => {
  const r = aggregate([
    deal({ id: 'a', currency: 'KRW', amountMinor: 억(10) }),
    deal({ id: 'b', currency: 'USD', amountMinor: '100000' }),
  ], spec())
  assert.equal(r.total.byCurrency.KRW, 억(10))
  assert.equal(r.total.byCurrency.USD, '100000')
  assert.equal(r.notes.mixedCurrency, true, '섞였으면 화면이 말해야 한다')
})

test('통화가 하나면 섞였다고 하지 않는다', () => {
  const r = aggregate([deal({ amountMinor: 억(1) })], spec())
  assert.equal(r.notes.mixedCurrency, false)
})

test('통화를 안 적었으면 원화로 본다 — 이 저장소의 기본이다', () => {
  const r = aggregate([deal({ currency: null, amountMinor: 억(1) })], spec())
  assert.equal(sumOf(r.total, 'KRW'), BigInt(억(1)))
})

// ── 사업 기간 ────────────────────────────────────────────
test('★ 사업 기간 기준은 여러 달에 나뉘고 1원도 새지 않는다', () => {
  const d = deal({
    status: 'WON', wonAtIso: '2026-01-01T00:00:00+09:00',
    startDateIso: '2026-01-15', endDateIso: '2026-03-20', amountMinor: '1000',
  })
  const whole = aggregate([d], spec({ metric: 'recognized', period: YEAR26, cols: 'month' }))
  assert.equal(sumOf(whole.total), BigInt(1000), '합이 원금과 같아야 한다')
  assert.equal(sumOf(cellAt(whole, ALL_KEY, '2026-01')), BigInt(334))
  assert.equal(sumOf(cellAt(whole, ALL_KEY, '2026-02')), BigInt(333))
})

test('★ 사업 기간 기준은 건수를 부풀리지 않는다 — 한 딜을 달 수만큼 세면 안 된다', () => {
  const d = deal({
    status: 'WON', startDateIso: '2026-01-15', endDateIso: '2026-03-20', amountMinor: '1000',
  })
  const r = aggregate([d], spec({ metric: 'recognized' }))
  assert.equal(r.total.count, 0, '기간 배분은 건수를 세지 않는다')
  assert.equal(r.notes.matched, 1, '대상 딜 수는 하나다')
})

test('기간이 없는 성사 딜은 인식 매출에 들어가지 않는다 — 지어내지 않는다', () => {
  const r = aggregate([deal({ status: 'WON', startDateIso: null, endDateIso: null, amountMinor: '1000' })],
    spec({ metric: 'recognized' }))
  assert.equal(sumOf(r.total), BigInt(0))
})

// ── 금액 칸 ──────────────────────────────────────────────
test('booked 는 확실한 것부터 고른다 — 계약 → 견적 → 예산 → 옛 칸', () => {
  const booked = metricOf('open_pipeline')!.amount
  assert.equal(amountOf(deal({ contractNetMinor: '3', quotedNetMinor: '2', budgetNetMinor: '1' }), booked), BigInt(3))
  assert.equal(amountOf(deal({ contractNetMinor: null, quotedNetMinor: '2', budgetNetMinor: '1' }), booked), BigInt(2))
  assert.equal(amountOf(deal({ contractNetMinor: null, quotedNetMinor: null, budgetNetMinor: '1' }), booked), BigInt(1))
  assert.equal(amountOf(deal({ contractNetMinor: null, quotedNetMinor: null, budgetNetMinor: null, amountMinor: '9' }), booked), BigInt(9))
})

test('★ 접기 전 값을 따로 물어볼 수 있다 — 「견적으로 나간 총액」', () => {
  const d = deal({ contractNetMinor: '300', quotedNetMinor: '200', budgetNetMinor: '100' })
  assert.equal(sumOf(aggregate([d], spec({ metric: 'quoted_sum' })).total), BigInt(200))
  assert.equal(sumOf(aggregate([d], spec({ metric: 'budget_sum' })).total), BigInt(100))
  assert.equal(sumOf(aggregate([d], spec({ metric: 'contract_sum' })).total), BigInt(300))
})

test('대상 집합이 상태로 갈린다', () => {
  const w = deal({ status: 'WON' }); const l = deal({ status: 'LOST' }); const o = deal({ status: 'OPEN' })
  assert.equal(inScope(o, 'OPEN'), true); assert.equal(inScope(w, 'OPEN'), false)
  assert.equal(inScope(w, 'CLOSED'), true); assert.equal(inScope(l, 'CLOSED'), true)
  assert.equal(inScope(o, 'CLOSED'), false); assert.equal(inScope(o, 'ALL'), true)
})

// ── 안전 ────────────────────────────────────────────────
test('★ 모르는 지표는 던진다 — 없는 이름을 조용히 0으로 답하지 않는다', () => {
  assert.throws(() => aggregate([], spec({ metric: '매출액' })), /모르는 지표/)
})

test('없는 칸은 빈 칸이다 — undefined 가 아니다', () => {
  const r = aggregate([], spec())
  assert.deepEqual(cellAt(r, 'x', 'y'), { count: 0, byCurrency: {} })
  assert.equal(sumOf(cellAt(r, 'x', 'y')), BigInt(0))
})

test('모르는 축은 「없음」으로 떨어진다 — 터지지 않는다', () => {
  assert.equal(bucketOf(deal(), '없는축').key, EMPTY_KEY)
})

test('한 딜이 낼 몫은 대개 하나다', () => {
  assert.equal(contributionsOf(deal(), metricOf('open_pipeline')!).length, 1)
  assert.equal(contributionsOf(deal({ expectedCloseIso: null }), metricOf('open_pipeline')!).length, 0)
})

test('행·열 구분자가 축 값에 나오지 않는 글자다', () => {
  assert.ok(CELL_SEP.length >= 2)
  assert.ok(!ALL_KEY.includes(CELL_SEP) && !EMPTY_KEY.includes(CELL_SEP))
})

test('집계 코어는 순수하다 — DB 도 시계도 모른다', () => {
  const src = readFileSync(new URL('./metric-agg.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'db/client', 'getCrmDb', 'findMany', 'new Date()', 'Date.now']) {
    assert.ok(!src.includes(banned), `집계 코어가 ${banned} 를 안다 — 숫자로 검증할 수 없게 된다`)
  }
})
