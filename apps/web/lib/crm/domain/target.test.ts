// lib/crm/domain/target.test.ts — 목표는 고르는 것이지 적는 것이 아니다
//
// 사용자 지시(2026-09-09): *"목표를 기간부터 입력폼으로 하면 정형화가 안된다
//  기간 대상 지표 이런건 다 정형화가 가능한거니 선택하게 해야 한다"*
//
// 자유 입력을 허용하면 「2026 상반기」와 「26년 상반기」가 다른 목표가 되고,
// 그 순간 달성률을 낼 수 없다. 이 가드가 그 문을 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  periodLabel, periodRange, periodContains, isPeriodStarted,
  shouldOfferNextYear, nextYearOf, NEXT_YEAR_PROMPT_MONTH,
  validatePeriod, validateScope, validateTarget, validateTargets,
  targetKey, findTarget, splitEvenly, subPeriods,
  TargetError, MAX_TARGETS, YEAR_MIN, YEAR_MAX,
  type TargetSpec,
} from './target.ts'

const ok = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 't1', metric: 'bookings', value: '10000000000',
  period: { kind: 'YEAR', year: 2026 },
  scope: { kind: 'ALL' },
  ...over,
})

// ── 기간 ────────────────────────────────────────────────
test('기간 이름이 사람이 부르는 말이다', () => {
  assert.equal(periodLabel({ kind: 'YEAR', year: 2026 }), '2026년')
  assert.equal(periodLabel({ kind: 'HALF', year: 2026, index: 2 }), '2026 하반기')
  assert.equal(periodLabel({ kind: 'QUARTER', year: 2026, index: 4 }), '2026 4분기')
  assert.equal(periodLabel({ kind: 'MONTH', year: 2026, index: 9 }), '2026년 9월')
})

test('★ 실측 앵커 — 2026 4분기는 10월 1일부터 12월 31일까지다', () => {
  assert.deepEqual(periodRange({ kind: 'QUARTER', year: 2026, index: 4 }),
    { from: '2026-10-01', to: '2026-12-31' })
})

test('달의 마지막 날을 정확히 낸다 — 30일·31일·윤년 2월', () => {
  assert.equal(periodRange({ kind: 'MONTH', year: 2026, index: 4 }).to, '2026-04-30')
  assert.equal(periodRange({ kind: 'MONTH', year: 2026, index: 1 }).to, '2026-01-31')
  assert.equal(periodRange({ kind: 'MONTH', year: 2026, index: 2 }).to, '2026-02-28')
  assert.equal(periodRange({ kind: 'MONTH', year: 2024, index: 2 }).to, '2024-02-29', '윤년')
})

test('반기 경계 — 상반기는 6월 30일에 끝나고 하반기는 7월 1일에 시작한다', () => {
  assert.deepEqual(periodRange({ kind: 'HALF', year: 2026, index: 1 }), { from: '2026-01-01', to: '2026-06-30' })
  assert.deepEqual(periodRange({ kind: 'HALF', year: 2026, index: 2 }), { from: '2026-07-01', to: '2026-12-31' })
})

test('기간 포함 판정은 양끝을 포함한다 — 마지막 날 딴 것이 빠지면 안 된다', () => {
  const q4 = { kind: 'QUARTER' as const, year: 2026, index: 4 }
  assert.equal(periodContains(q4, '2026-10-01'), true, '첫날')
  assert.equal(periodContains(q4, '2026-12-31'), true, '마지막 날')
  assert.equal(periodContains(q4, '2026-09-30'), false)
  assert.equal(periodContains(q4, '2027-01-01'), false)
})

test('시작된 기간은 잠긴다 — 지난 달 달성률이 오늘 달라지면 안 된다', () => {
  const y26 = { kind: 'YEAR' as const, year: 2026 }
  assert.equal(isPeriodStarted(y26, '2026-09-09'), true)
  assert.equal(isPeriodStarted(y26, '2026-01-01'), true, '첫날부터 잠긴다')
  assert.equal(isPeriodStarted(y26, '2025-12-31'), false, '아직 안 왔으면 고칠 수 있다')
})

test('★ 9월부터 내년 목표를 묻는다 — 끝나고 정하면 1월 달성률을 못 낸다', () => {
  assert.equal(shouldOfferNextYear('2026-08-31'), false)
  assert.equal(shouldOfferNextYear('2026-09-01'), true)
  assert.equal(shouldOfferNextYear('2026-12-31'), true)
  assert.equal(nextYearOf('2026-09-09'), 2027)
  assert.equal(NEXT_YEAR_PROMPT_MONTH, 9)
})

// ── 검증 ────────────────────────────────────────────────
test('기간 종류를 안 고르면 거절한다', () => {
  assert.throws(() => validatePeriod({ year: 2026 }), TargetError)
  assert.throws(() => validatePeriod({ kind: '반기', year: 2026 }), TargetError)
})

test('★ 없는 5분기·13월을 만들지 않는다', () => {
  assert.throws(() => validatePeriod({ kind: 'QUARTER', year: 2026, index: 5 }), TargetError)
  assert.throws(() => validatePeriod({ kind: 'MONTH', year: 2026, index: 13 }), TargetError)
  assert.throws(() => validatePeriod({ kind: 'HALF', year: 2026, index: 3 }), TargetError)
  assert.throws(() => validatePeriod({ kind: 'QUARTER', year: 2026, index: 0 }), TargetError)
})

test('★ 연도 범위를 잠근다 — 6자리 연도가 통과하면 날짜 계산이 통째로 깨진다', () => {
  assert.throws(() => validatePeriod({ kind: 'YEAR', year: 202600 }), TargetError)
  assert.throws(() => validatePeriod({ kind: 'YEAR', year: 1999 }), TargetError)
  assert.equal(validatePeriod({ kind: 'YEAR', year: YEAR_MIN }).year, YEAR_MIN)
  assert.equal(validatePeriod({ kind: 'YEAR', year: YEAR_MAX }).year, YEAR_MAX)
})

test('연간은 index 를 요구하지 않는다 — 있으면 뜻이 없다', () => {
  assert.deepEqual(validatePeriod({ kind: 'YEAR', year: 2026 }), { kind: 'YEAR', year: 2026 })
})

test('★ 모르는 기준에는 목표를 못 건다 — AI 도우미도 같은 문으로 들어온다', () => {
  assert.throws(() => validateScope({ kind: 'DIMENSION', dimension: '고객군', value: 'x' }), TargetError)
  assert.throws(() => validateScope({ kind: 'DIMENSION', dimension: 'pipeline', value: '  ' }), TargetError)
  assert.deepEqual(validateScope({ kind: 'ALL' }), { kind: 'ALL' })
  assert.deepEqual(validateScope({ kind: 'DIMENSION', dimension: 'pipeline', value: 'p1' }),
    { kind: 'DIMENSION', dimension: 'pipeline', value: 'p1' })
})

test('★ 파생 지표·적을수록 좋은 것에는 목표를 못 건다', () => {
  assert.throws(() => validateTarget(ok({ metric: 'attainment' })), TargetError)
  assert.throws(() => validateTarget(ok({ metric: 'overdue' })), TargetError)
  assert.throws(() => validateTarget(ok({ metric: '매출액' })), TargetError)
})

test('★ 단위는 지표가 정한다 — 사람이 고르면 「수주 · 건」이 나온다', () => {
  assert.equal(validateTarget(ok({ metric: 'bookings' })).unit, 'money')
  assert.equal(validateTarget(ok({ metric: 'won_count' })).unit, 'count')
  // 사람이 단위를 실어 보내도 무시된다
  assert.equal(validateTarget(ok({ metric: 'bookings', unit: 'count' })).unit, 'money')
})

test('★ 값은 정수 문자열이다 — 실수로 다루면 원 단위가 조용히 어긋난다', () => {
  assert.equal(validateTarget(ok({ value: '10000000000' })).value, '10000000000')
  assert.equal(validateTarget(ok({ value: 100 })).value, '100', '숫자로 와도 받는다')
  assert.throws(() => validateTarget(ok({ value: '10억' })), TargetError)
  assert.throws(() => validateTarget(ok({ value: '1.5' })), TargetError)
  assert.throws(() => validateTarget(ok({ value: '-5' })), TargetError)
  assert.throws(() => validateTarget(ok({ value: '' })), TargetError)
})

test('아주 큰 값도 정밀도를 잃지 않는다 — 숫자로 바꾸지 않는다', () => {
  assert.equal(validateTarget(ok({ value: '9007199254740993' })).value, '9007199254740993')
})

test('★ 같은 기간·대상·지표에 목표를 두 번 두지 않는다 — 어느 쪽이 진짜인지 모른다', () => {
  const a = ok({ id: 'a' })
  const b = ok({ id: 'b' })
  assert.throws(() => validateTargets([a, b]), TargetError)
})

test('대상이 다르면 같은 기간·지표라도 별개다', () => {
  const a = ok({ id: 'a' })
  const b = ok({ id: 'b', scope: { kind: 'DIMENSION', dimension: 'pipeline', value: 'p1' } })
  assert.equal(validateTargets([a, b]).length, 2)
})

test('★ 조용히 버리지 않는다 — 하나라도 못 읽으면 통째로 거절한다', () => {
  assert.throws(() => validateTargets([ok(), ok({ id: 'x', metric: 'attainment' })]), TargetError)
  assert.throws(() => validateTargets('배열아님'), TargetError)
  assert.throws(() => validateTargets(Array.from({ length: MAX_TARGETS + 1 }, (_, i) => ok({ id: `t${i}` }))), TargetError)
})

// ── 찾기·배분 ────────────────────────────────────────────
test('★ 못 찾으면 null — 0 을 돌려주면 화면이 「목표 0원」으로 그린다', () => {
  const ts = [validateTarget(ok())] as TargetSpec[]
  assert.ok(findTarget(ts, { period: { kind: 'YEAR', year: 2026 }, scope: { kind: 'ALL' }, metric: 'bookings' }))
  assert.equal(findTarget(ts, { period: { kind: 'YEAR', year: 2027 }, scope: { kind: 'ALL' }, metric: 'bookings' }), null)
  assert.equal(findTarget([], { period: { kind: 'YEAR', year: 2026 }, scope: { kind: 'ALL' }, metric: 'bookings' }), null)
})

test('열쇠가 기간·대상·지표 셋을 모두 가른다', () => {
  const base = { period: { kind: 'YEAR' as const, year: 2026 }, scope: { kind: 'ALL' as const }, metric: 'bookings' }
  assert.notEqual(targetKey(base), targetKey({ ...base, metric: 'won_count' }))
  assert.notEqual(targetKey(base), targetKey({ ...base, period: { kind: 'QUARTER', year: 2026, index: 4 } }))
  assert.notEqual(targetKey(base), targetKey({ ...base, scope: { kind: 'DIMENSION', dimension: 'pipeline', value: 'p1' } }))
})

test('★ 배분은 1원도 잃지 않는다 — 합이 원본과 다르면 분기 합계가 연간을 반박한다', () => {
  for (const [total, parts] of [['100', 3], ['10000000000', 4], ['7', 4], ['0', 12]] as const) {
    const got = splitEvenly(total, parts)
    assert.equal(got.length, parts)
    assert.equal(got.reduce((s, v) => s + BigInt(v), 0n), BigInt(total), `${total}/${parts} 합이 어긋났다`)
  }
})

test('배분은 앞쪽이 먼저 받는다 — 다시 계산해도 같은 답이어야 한다', () => {
  assert.deepEqual(splitEvenly('100', 3), ['34', '33', '33'])
  assert.deepEqual(splitEvenly('100', 3), splitEvenly('100', 3))
})

test('연간만 쪼갠다 — 분기를 또 쪼개면 뜻이 없다', () => {
  assert.equal(subPeriods({ kind: 'YEAR', year: 2026 }, 'QUARTER').length, 4)
  assert.equal(subPeriods({ kind: 'YEAR', year: 2026 }, 'MONTH').length, 12)
  assert.throws(() => subPeriods({ kind: 'QUARTER', year: 2026, index: 1 }, 'MONTH'), TargetError)
})

test('쪼갠 기간이 원래 기간을 빈틈없이 덮는다', () => {
  const y = { kind: 'YEAR' as const, year: 2026 }
  const qs = subPeriods(y, 'QUARTER')
  assert.equal(periodRange(qs[0]).from, periodRange(y).from)
  assert.equal(periodRange(qs[3]).to, periodRange(y).to)
  for (let i = 1; i < qs.length; i++) {
    const prevTo = new Date(`${periodRange(qs[i - 1]).to}T00:00:00Z`).getTime()
    const curFrom = new Date(`${periodRange(qs[i]).from}T00:00:00Z`).getTime()
    assert.equal(curFrom - prevTo, 86_400_000, `${i}번째 분기 사이에 틈이 있다`)
  }
})

// ── 순수성 ──────────────────────────────────────────────
test('목표 선언은 순수하다 — DB 도 시계도 모른다', () => {
  const src = readFileSync(new URL('./target.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'db/client', 'getCrmDb', 'findMany', 'new Date()', 'Date.now']) {
    assert.ok(!src.includes(banned), `목표 선언이 ${banned} 를 안다 — 시험할 수 없게 된다`)
  }
})

test('대상 값을 코드에 나열하지 않는다 (P-1)', () => {
  const src = readFileSync(new URL('./target.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const v of ['공공', 'B2B', 'B2G', '대학', '엔터프라이즈', 'GPU 인프라']) {
    assert.ok(!body.includes(v), `목표 선언에 값 「${v}」이 박혀 있다(P-1)`)
  }
})
