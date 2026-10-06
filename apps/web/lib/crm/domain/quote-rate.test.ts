// lib/crm/domain/quote-rate.test.ts — 환산이 **고객의 검산을 견디는지** 보는 가드
//
// 시간당을 견적서에 적는 순간 고객이 곱해 본다. 월 999,360원을 730 으로 나누면
// 1,368.98… 이라 1,369원으로 적게 되는데, 1,369 × 1,460 = 1,998,740 으로 합계보다 20원 많다.
// 그래서 **나누어떨어졌는지를 값으로 돌려주고** 화면이 「약」을 붙인다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePeriod, hourlyFromMonthly, monthlyFromHourly, monthlyFromTotal, hourlyFromTotal,
  toDateKey, DEFAULT_HOURS_PER_MONTH,
  hoursFromQuantity, monthsFromHours, rateFromHours,
  durationHours, durationFactor,
  durationFromDealPeriod,
} from './quote-rate.ts'

/* ── 기간 ────────────────────────────────────── */

test('★ 10월 7일부터 12월 6일까지는 2개월이다 — 시작일과 종료일을 둘 다 센다', () => {
  const p = computePeriod('2026-10-07', '2026-12-06', 730)
  assert.ok(p)
  assert.equal(p.months, 2)
  assert.equal(p.days, 61)
  assert.equal(p.totalHours, 1460, '2개월 × 730h')
})

test('★ 월 기준 시간이 총 시간을 바꾼다', () => {
  assert.equal(computePeriod('2026-10-07', '2026-12-06', 720)?.totalHours, 1440)
  assert.equal(computePeriod('2026-10-07', '2026-12-06', 730)?.totalHours, 1460)
})

test('★ 어중간한 기간은 개월을 말하지 않는다', () => {
  // 45일짜리 — 개월로 떨어지지 않으므로 일수와 시간으로만 말한다
  const p = computePeriod('2026-10-07', '2026-11-20', 730)
  assert.ok(p)
  assert.equal(p.months, null)
  assert.equal(p.days, 45)
  assert.equal(p.totalHours, 45 * 24, '개월을 모르면 일수 × 24')
})

test('★ 말일에서 시작해도 개월이 선다', () => {
  // 1/31 + 1개월은 2/28(윤년 아님) — 그 하루 전이 2/27
  assert.equal(computePeriod('2026-01-31', '2026-02-27', 730)?.months, 1)
  // 12/31 에서 한 해
  assert.equal(computePeriod('2026-12-31', '2027-12-30', 730)?.months, 12)
})

test('★ 하루짜리도 센다', () => {
  const p = computePeriod('2026-10-07', '2026-10-07', 730)
  assert.equal(p?.days, 1)
  assert.equal(p?.months, null)
  assert.equal(p?.totalHours, 24)
})

test('★ 기간을 모르면 null 이다 — 축을 못 세운다', () => {
  assert.equal(computePeriod(null, '2026-12-06'), null)
  assert.equal(computePeriod('2026-10-07', null), null)
  assert.equal(computePeriod(null, null), null)
})

test('★ 끝이 시작보다 앞서면 null 이다', () => {
  assert.equal(computePeriod('2026-12-06', '2026-10-07'), null)
})

test('★ Date 로 줘도 날짜가 안 밀린다', () => {
  // Prisma 는 UTC 자정으로 저장한다 — 로컬 타임존으로 읽으면 하루가 당겨진다
  const p = computePeriod(new Date('2026-10-07T00:00:00.000Z'), new Date('2026-12-06T00:00:00.000Z'), 730)
  assert.equal(p?.start, '2026-10-07')
  assert.equal(p?.end, '2026-12-06')
  assert.equal(p?.months, 2)
})

test('★ 기준 시간을 안 주면 730 을 쓴다', () => {
  assert.equal(DEFAULT_HOURS_PER_MONTH, 730)
  assert.equal(computePeriod('2026-10-07', '2026-12-06')?.totalHours, 1460)
})

/* ── 환산 ────────────────────────────────────── */

test('★ 999,360원은 720 으로 딱 떨어지고 730 으로는 안 떨어진다', () => {
  const by720 = hourlyFromMonthly(999_360, 720)
  assert.equal(by720.minor, 1388)
  assert.equal(by720.exact, true, '720 은 딱 떨어져 「약」이 필요 없다')

  const by730 = hourlyFromMonthly(999_360, 730)
  assert.equal(by730.minor, 1369)
  assert.equal(by730.exact, false, '730 은 안 떨어져 「약」을 붙여야 한다')
})

test('★ 안 떨어질 때 고객이 곱하면 합계와 어긋난다 — 그래서 「약」이 필요하다', () => {
  const p = computePeriod('2026-10-07', '2026-12-06', 730)
  const h = hourlyFromMonthly(999_360, 730)
  const 고객이곱한값 = h.minor * p.totalHours
  const 실제합계 = 999_360 * 2
  assert.equal(실제합계, 1_998_720)
  assert.equal(고객이곱한값, 1_998_740)
  assert.equal(고객이곱한값 - 실제합계, 20, '20원 어긋난다')
  assert.equal(h.exact, false, '어긋나는 경우는 exact 가 false 여야 한다')
})

test('★ 720 으로 맞추면 곱해도 합계와 같다', () => {
  const p = computePeriod('2026-10-07', '2026-12-06', 720)
  const h = hourlyFromMonthly(999_360, 720)
  assert.equal(h.minor * p.totalHours, 999_360 * 2)
  assert.equal(h.exact, true)
})

test('★ 시간당에서 월로 가는 길은 곱셈이라 늘 맞는다', () => {
  const m = monthlyFromHourly(1388, 720)
  assert.equal(m.minor, 999_360)
  assert.equal(m.exact, true)
})

test('★ 기간 총액에서 월과 시간당을 되짚는다', () => {
  const p = computePeriod('2026-10-07', '2026-12-06', 720)
  assert.equal(monthlyFromTotal(1_998_720, p.months)?.minor, 999_360)
  assert.equal(monthlyFromTotal(1_998_720, p.months)?.exact, true)
  assert.equal(hourlyFromTotal(1_998_720, p.totalHours)?.minor, 1388)
})

test('★ 개월을 모르면 월 금액을 말하지 않는다', () => {
  assert.equal(monthlyFromTotal(1_998_720, null), null)
  assert.equal(monthlyFromTotal(1_998_720, 0), null)
})

test('★ 0 으로 나누지 않는다', () => {
  assert.equal(hourlyFromMonthly(999_360, 0).minor, 0)
  assert.equal(hourlyFromMonthly(999_360, 0).exact, false)
  assert.equal(hourlyFromTotal(1_998_720, 0), null)
})

/* ── 날짜 키 ─────────────────────────────────── */

test('★ 날짜 키는 열 글자다', () => {
  assert.equal(toDateKey('2026-10-07T00:00:00.000Z'), '2026-10-07')
  assert.equal(toDateKey('2026-10-07'), '2026-10-07')
  assert.equal(toDateKey(null), null)
  assert.equal(toDateKey(''), null)
  assert.equal(toDateKey(new Date('nope')), null)
})

/* ── 수량에서 오는 시간 축 ────────────────────── */

test('★ 단위가 시간이면 수량이 곧 총 시간이다', () => {
  for (const u of ['Hours', 'hours', 'h', 'H', ' hr ', 'HRS', 'hour', '시간']) {
    assert.equal(hoursFromQuantity(u, 1440), 1440, `${u} 를 시간으로 안 읽었다`)
  }
  // Prisma 가 주는 Decimal 은 문자열로 온다
  assert.equal(hoursFromQuantity('Hours', '1440.000'), 1440)
})

test('★ 시간이 아닌 단위는 세지 않는다 — 한 식이 시간당이 되면 안 된다', () => {
  for (const u of ['식', 'User', 'M/M', '개월', 'EA', '', null, undefined]) {
    assert.equal(hoursFromQuantity(u, 1440), null, `${u} 를 시간으로 읽었다`)
  }
})

test('★ 수량이 없거나 음수면 시간이 아니다', () => {
  assert.equal(hoursFromQuantity('Hours', 0), null)
  assert.equal(hoursFromQuantity('Hours', -5), null)
  assert.equal(hoursFromQuantity('Hours', null), null)
  assert.equal(hoursFromQuantity('Hours', 'abc'), null)
})

test('★ 총 시간이 월 기준으로 딱 나뉘면 개월이 선다', () => {
  assert.equal(monthsFromHours(1440, 720), 2)
  assert.equal(monthsFromHours(1460, 730), 2)
  // 어중간하면 개월을 말하지 않는다
  assert.equal(monthsFromHours(1000, 720), null)
  assert.equal(monthsFromHours(1440, 730), null)
  assert.equal(monthsFromHours(0, 720), null)
  assert.equal(monthsFromHours(1440, 0), null)
})

test('★ 1,440시간 1,998,720원은 720 기준으로 2개월 999,360원 시간당 1,388원이다', () => {
  const r = rateFromHours(1_998_720, 1440, 720)
  assert.ok(r)
  assert.equal(r.totalHours, 1440)
  assert.equal(r.months, 2)
  assert.equal(r.monthlyMinor, 999_360)
  assert.equal(r.hourlyMinor, 1388)
  assert.equal(r.hourlyExact, true, '1,388 × 1,440 = 1,998,720 이라 「약」이 붙으면 안 된다')
})

test('★ 개월이 안 떨어지면 월 금액을 말하지 않는다 — 시간당은 그대로 센다', () => {
  const r = rateFromHours(1_998_720, 1000, 720)
  assert.ok(r)
  assert.equal(r.months, null)
  assert.equal(r.monthlyMinor, null)
  assert.equal(r.hourlyMinor, 1999, '1,998,720 ÷ 1,000 = 1,998.72 → 1,999')
  assert.equal(r.hourlyExact, false, '안 떨어졌으면 「약」이 붙어야 한다')
})

test('★ 개월을 아는 쪽은 그 값을 넘긴다 — 기간에서 온 축이 시간으로 덮이지 않는다', () => {
  // 2개월 1,440시간인데 기준이 730 이면 시간에서는 개월이 안 떨어진다.
  // 기간이 센 2개월을 넘기면 월 금액이 선다.
  const r = rateFromHours(1_998_720, 1440, 730, 2)
  assert.ok(r)
  assert.equal(r.months, 2)
  assert.equal(r.monthlyMinor, 999_360)
})

test('★ 시간이 없으면 축이 아예 안 선다', () => {
  assert.equal(rateFromHours(1_998_720, 0, 720), null)
  assert.equal(rateFromHours(1_998_720, -1, 720), null)
})

/* ──────────────────────────────────────────────────────────────────────────
   기간 칸 — 「얼마 동안」 축

   실측 2026-10-06: 품목 164줄 가운데 공급 기간 날짜를 적은 줄이 **0줄**이었다.
   그 칸은 금액을 안 바꾸기 때문이다. 기간 칸은 금액을 바꾸므로 반드시 검산을 받는다.
   ────────────────────────────────────────────────────────────────────────── */

test('★ 기간을 시간으로 편다 — 네 단위가 각자 제 수로 펴진다', () => {
  assert.equal(durationHours(2, 'MONTH', 730), 1460, '2개월 × 730')
  assert.equal(durationHours(30, 'DAY'), 720, '30일 × 24')
  assert.equal(durationHours(1, 'YEAR', 730), 8760, '1년 = 12 × 730')
  assert.equal(durationHours(48, 'HOUR'), 48, '시간은 그대로')
  // 월 기준 시간이 바뀌면 개월과 년만 따라 움직인다 — 일과 시간은 달력이라 안 바뀐다
  assert.equal(durationHours(2, 'MONTH', 720), 1440)
  assert.equal(durationHours(30, 'DAY', 720), 720)
})

test('★ 총 시간은 달력 시간이다 — 수량을 곱하지 않는다', () => {
  /*
    17대를 2개월 쓰면 **장비-시간**은 17 × 1,460 = 24,820h 이지만
    여기서 세는 것은 **달력 시간** 1,460h 다. 열일곱 배 차이라 어느 쪽인지 숨기면 안 되고,
    시간당 금액을 적는 쪽이 「17대 기준」이라고 이름에 적는다.
  */
  assert.equal(durationHours(2, 'MONTH', 730), 1460)
  assert.notEqual(durationHours(2, 'MONTH', 730), 24_820)
})

test('★ 못 세면 null 이다 — 0 이나 1 로 눕히지 않는다', () => {
  assert.equal(durationHours(0, 'MONTH'), null, '0 은 「기간 없음」이 아니라 틀린 값이다')
  assert.equal(durationHours(-1, 'MONTH'), null)
  assert.equal(durationHours(2, 'WEEK'), null, '모르는 단위는 지어내지 않는다')
  assert.equal(durationHours(2, null), null)
  assert.equal(durationHours(null, 'MONTH'), null)
  assert.equal(durationHours('이상한 값', 'MONTH'), null)
})

test('★ 기준 단위가 있는 종류만 환산한다 — 시간당 단가에 2개월은 1,460 배다', () => {
  assert.equal(durationFactor(2, 'MONTH', 'HOUR', 730), 1460, '시간당 단가 × 2개월')
  assert.equal(durationFactor(2, 'MONTH', 'MONTH', 730), 2, '월 단가 × 2개월')
  assert.equal(durationFactor(1460, 'HOUR', 'MONTH', 730), 2, '월 단가에 1,460시간을 적으면 2개월')
  assert.equal(durationFactor(48, 'HOUR', 'HOUR', 730), 48)
})

test('★ 기준이 없는 종류는 적은 수를 그대로 곱한다 — 없는 기준을 지어내지 않는다', () => {
  /*
    「17대 × 936,000원 × 2개월」의 단가는 **한 대를 한 달** 쓰는 값이고,
    그것이 원본 문서가 실제로 하는 말이다(실측 2026-10-06, 견적 DA-2026-1006-03).
    여기서 기준을 지어내 환산하면 사람이 적지 않은 숫자가 금액에 들어간다.
  */
  assert.equal(durationFactor(2, 'MONTH', null), 2)
  assert.equal(durationFactor(2, 'DAY', null), 2)
  assert.equal(durationFactor(2, 'YEAR', null), 2)
})

test('★ 기간을 안 적었으면 null 이다 — 1 을 돌려주면 화면이 「× 1개월」을 적는다', () => {
  assert.equal(durationFactor(null, null, null), null)
  assert.equal(durationFactor(2, null, 'MONTH'), null, '단위만 없어도 안 센다 — 둘은 한 벌이다')
  assert.equal(durationFactor(null, 'MONTH', 'MONTH'), null)
  assert.equal(durationFactor(0, 'MONTH', 'MONTH'), null)
})

test('★ 딜 기간이 새 품목의 기본 기간이 된다 — 딱 떨어지면 개월, 아니면 일', () => {
  // 10/7 ~ 12/6 은 딱 2개월(시작일과 종료일을 둘 다 센다)
  assert.deepEqual(durationFromDealPeriod('2026-10-07', '2026-12-06'), { value: '2', unit: 'MONTH' })
  // 45일처럼 어중간하면 개월을 말하지 않는다 — 1.5개월은 시간 환산이 안 떨어져 「약」이 늘 붙는다
  assert.deepEqual(durationFromDealPeriod('2026-10-01', '2026-11-14'), { value: '45', unit: 'DAY' })
  assert.deepEqual(durationFromDealPeriod('2026-01-01', '2026-12-31'), { value: '12', unit: 'MONTH' })
})

test('★ 딜에 기간이 없으면 null 이다 — 1 로 눕히면 사람이 안 적은 「한 달」이 금액에 들어간다', () => {
  assert.equal(durationFromDealPeriod(null, null), null)
  assert.equal(durationFromDealPeriod('2026-10-07', null), null, '끝이 협의 중인 딜이 실제로 있다')
  assert.equal(durationFromDealPeriod(null, '2026-12-06'), null)
  assert.equal(durationFromDealPeriod('2026-12-06', '2026-10-07'), null, '거꾸로면 안 센다')
})
