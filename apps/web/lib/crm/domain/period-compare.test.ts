/**
 * 기간 비교 — 무엇과 견주는가
 *
 * 왜 생겼나: 리포트가 「이번 분기 3억」이라고만 말했다. 그 숫자가 좋은 것인지
 * 나쁜 것인지는 **무엇과 견주는지**가 없으면 아무도 모른다. 분기 보고에서
 * 가장 먼저 묻는 두 질문이 「지난 분기보다는?」과 「작년 이맘때보다는?」이다.
 *
 * 여기서 특히 보는 것: 견줄 것이 없을 때 **0 을 돌려주지 않는** 것.
 * 0 은 「견줘 봤더니 같다」로 읽힌다. 안 센 것과 세어 보니 0 인 것은 다른 사실이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shiftPeriod, prevPeriod, lastYearPeriod, compareTarget,
  parseCompareKey, COMPARE_ORDER, deltaRatio, compareSums,
} from './period-compare.ts'
import { shiftReportPeriod } from './report-axis.ts'
import type { Period } from './target.ts'

const Q = (year: number, index: number): Period => ({ kind: 'QUARTER', year, index })

test('이전 기간 — 해를 거슬러도 한 칸이다', () => {
  assert.deepEqual(prevPeriod(Q(2026, 1)), Q(2025, 4), '2026년 1분기의 이전 기간은 2025년 4분기다')
  assert.deepEqual(prevPeriod(Q(2026, 3)), Q(2026, 2))
  assert.deepEqual(prevPeriod({ kind: 'MONTH', year: 2026, index: 1 }), { kind: 'MONTH', year: 2025, index: 12 })
  assert.deepEqual(prevPeriod({ kind: 'HALF', year: 2026, index: 1 }), { kind: 'HALF', year: 2025, index: 2 })
  assert.deepEqual(prevPeriod({ kind: 'YEAR', year: 2026 }), { kind: 'YEAR', year: 2025 })
})

test('전년 동기 — 종류와 칸은 그대로고 해만 하나 뒤다', () => {
  assert.deepEqual(lastYearPeriod(Q(2026, 1)), Q(2025, 1), '2026년 1분기의 전년 동기는 2025년 1분기다')
  assert.deepEqual(lastYearPeriod({ kind: 'MONTH', year: 2026, index: 2 }), { kind: 'MONTH', year: 2025, index: 2 })
})

test('★ 한 칸 옮기는 셈이 한 곳에만 있다', () => {
  /*
    `report-axis` 에도 같은 셈이 있었다. 둘이 따로 있으면 한쪽만 고쳐지고,
    그때부터 「이전 기간」 단추와 「이전 기간 비교」가 다른 기간을 가리킨다.
  */
  for (const p of [Q(2026, 1), Q(2025, 4), { kind: 'MONTH' as const, year: 2026, index: 12 }, { kind: 'YEAR' as const, year: 2026 }]) {
    assert.deepEqual(
      shiftReportPeriod({ rolling: false, period: p }, -1),
      { rolling: false, period: shiftPeriod(p, -1) },
      '화면의 앞뒤 이동과 비교가 다른 기간을 가리킨다',
    )
  }
})

test('비교 방식 — 모르는 값은 기본값이지 오류가 아니다', () => {
  assert.equal(parseCompareKey('PREV'), 'PREV')
  assert.equal(parseCompareKey('YOY'), 'YOY')
  assert.equal(parseCompareKey('NONE'), 'NONE')
  for (const bad of ['', null, undefined, 'prev', '지난주', '../../etc']) {
    assert.equal(parseCompareKey(bad), 'PREV', `${String(bad)} 가 기본값으로 안 간다`)
  }
  assert.deepEqual([...COMPARE_ORDER], ['PREV', 'YOY', 'NONE'])
})

test('비교 안 함을 고르면 견줄 기간이 없다', () => {
  assert.equal(compareTarget(Q(2026, 1), 'NONE'), null)
  assert.deepEqual(compareTarget(Q(2026, 1), 'PREV'), Q(2025, 4))
  assert.deepEqual(compareTarget(Q(2026, 1), 'YOY'), Q(2025, 1))
})

// ------------------------------------------------------------
// 견줄 것이 없을 때
// ------------------------------------------------------------

test('★ 비교 기간에 값이 없으면 0 이 아니라 null 이다', () => {
  // 0 을 돌려주면 화면이 「0%」를 그리고, 사람은 그것을 「작년과 같다」로 읽는다
  assert.equal(deltaRatio(BigInt(100), null), null, '안 센 것이 0% 로 보이면 안 된다')
  assert.equal(deltaRatio(BigInt(100), BigInt(0)), null, '0 에서 늘어난 것은 비율로 말할 수 없다')
  assert.equal(deltaRatio(BigInt(0), BigInt(0)), null)
})

test('비율은 비교 기간을 바닥으로 잰다', () => {
  assert.equal(deltaRatio(BigInt(150), BigInt(100)), 0.5)
  assert.equal(deltaRatio(BigInt(50), BigInt(100)), -0.5)
  assert.equal(deltaRatio(BigInt(100), BigInt(100)), 0, '같으면 0 이다. 이것은 「견줄 것 없음」과 다른 사실이다')
})

// ------------------------------------------------------------
// 통화
// ------------------------------------------------------------

test('★ 통화를 합치지 않는다, 비교도 통화별로 한다', () => {
  const now = [
    { currency: 'KRW', totalMinor: '300000000' },
    { currency: 'USD', totalMinor: '20000' },
  ]
  const before = [
    { currency: 'KRW', totalMinor: '200000000' },
    { currency: 'USD', totalMinor: '40000' },
  ]
  const rows = compareSums(now, before)
  assert.equal(rows.length, 2, '통화 수만큼 줄이 나온다. 합계 한 줄로 접으면 뜻이 없다')

  const krw = rows.find((r) => r.currency === 'KRW')!
  assert.equal(krw.ratio, 0.5)
  assert.equal(krw.state, 'ok')
  assert.equal(krw.beforeMinor, '200000000')

  const usd = rows.find((r) => r.currency === 'USD')!
  assert.equal(usd.ratio, -0.5, '원이 늘었다고 달러도 늘었다고 하지 않는다')

  // 합계 칸이 없다. 있으면 누군가 그 숫자를 보고서에 쓴다
  assert.ok(!rows.some((r) => r.currency === 'TOTAL' || r.currency === 'ALL'))
})

test('이번 기간에만 있는 통화는 「견줄 것 없음」이다', () => {
  const rows = compareSums([{ currency: 'JPY', totalMinor: '500000' }], [{ currency: 'KRW', totalMinor: '100' }])
  const jpy = rows.find((r) => r.currency === 'JPY')!
  assert.equal(jpy.ratio, null)
  assert.equal(jpy.state, 'noBase', '달러로 처음 따낸 것을 「0% 성장」으로 적으면 거짓이다')
})

test('비교 기간에만 있는 통화도 줄로 남는다', () => {
  // 숨기면 「작년에 달러 매출이 있었다」는 사실이 화면에서 사라진다
  const rows = compareSums([{ currency: 'KRW', totalMinor: '100' }], [{ currency: 'USD', totalMinor: '900' }])
  const usd = rows.find((r) => r.currency === 'USD')
  assert.ok(usd, '비교 기간에만 있던 통화가 사라졌다')
  assert.equal(usd!.nowMinor, '0')
  assert.equal(usd!.state, 'gone')
})

test('비교 기간 자체가 없으면 줄마다 그 사실을 들고 있다', () => {
  const rows = compareSums([{ currency: 'KRW', totalMinor: '100' }], null)
  assert.equal(rows[0].state, 'noPeriod', '최근 12개월처럼 견줄 달력 기간이 없는 경우')
  assert.equal(rows[0].ratio, null)
})
