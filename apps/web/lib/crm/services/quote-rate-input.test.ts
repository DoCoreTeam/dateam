// lib/crm/services/quote-rate-input.test.ts — 금액 표시 선택이 **서버를 지나며 추려지는지** 보는 가드
//
// 이 값들은 밖에서 온다(화면이 보낸다). 둘은 다루는 법이 다르다:
//   · **키 목록**은 모르는 것을 버린다 — 화면 판이 갈려 새 키가 섞였을 때 저장이 통째로
//     막히면 견적을 못 쓴다. 버려도 잃는 것은 표시 하나다.
//   · **월 기준 시간**은 거절한다 — 금액을 나누는 수라 틀리면 견적서에 틀린 단가가 찍힌다.
//     0 이 들어오면 나눗셈이 터지고, 1 이 들어오면 시간당이 월 단가와 같아진다.
//
// 저장·조회 칸이 실제로 이어져 있는지는 아래 소스 가드가 본다 — 정규화만 맞고
// SELECT 에 칸이 없으면 값이 저장은 되는데 **안 돌아와서** 화면이 늘 빈 선택을 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toRateDisplay, toDateOrNull } from './quote.ts'
import { RATE_AXIS_ORDER, LINE_NOTE_ORDER, TOTAL_CONV_ORDER } from '../../terms/quote.ts'

const SERVICE = readFileSync(new URL('./quote.ts', import.meta.url), 'utf-8')

/* ── 키 목록 ─────────────────────────────────── */

test('★ 아는 키만 남고 모르는 키는 버린다', () => {
  const got = toRateDisplay({
    rateAxisKeys: ['total', 'hourly', 'nope', ''],
    lineNoteKeys: ['period', '../../etc/passwd'],
    totalConvKeys: ['hourly', 'DROP TABLE'],
  })
  assert.deepEqual(got.rateAxisKeys, ['total', 'hourly'])
  assert.deepEqual(got.lineNoteKeys, ['period'])
  assert.deepEqual(got.totalConvKeys, ['hourly'])
})

test('★ 순서는 용어집이 정한다 — 화면이 보낸 차례를 따르지 않는다', () => {
  // 같은 선택인데 보낸 차례가 다르다고 견적서가 다르게 인쇄되면 안 된다
  const a = toRateDisplay({ rateAxisKeys: ['hourly', 'monthly', 'total'] })
  const b = toRateDisplay({ rateAxisKeys: ['total', 'monthly', 'hourly'] })
  assert.deepEqual(a.rateAxisKeys, b.rateAxisKeys)
  assert.deepEqual(a.rateAxisKeys, [...RATE_AXIS_ORDER])
})

test('★ 안 보내면 빈 목록이다 — 지금과 같은 견적서가 나온다', () => {
  const got = toRateDisplay({})
  assert.deepEqual(got.rateAxisKeys, [])
  assert.deepEqual(got.lineNoteKeys, [])
  assert.deepEqual(got.totalConvKeys, [])
  assert.equal(got.rateHoursPerMonth, null)
})

test('★ 목록이 아닌 것이 와도 터지지 않는다', () => {
  // 화면 오류나 옛 판이 문자열 하나를 보낼 수 있다
  const got = toRateDisplay({ rateAxisKeys: 'total' as unknown as string[] })
  assert.deepEqual(got.rateAxisKeys, [])
})

/* ── 월 기준 시간 ────────────────────────────── */

test('★ 월 기준 시간은 범위 밖이면 거절한다', () => {
  for (const bad of [0, -1, 8785, 100000]) {
    assert.throws(
      () => toRateDisplay({ rateHoursPerMonth: bad }),
      /월 기준 시간/,
      `${bad} 이 통과했다 — 금액을 나누는 수라 틀리면 견적서에 틀린 단가가 찍힌다`,
    )
  }
})

test('★ 월 기준 시간은 정수가 아니면 거절한다', () => {
  assert.throws(() => toRateDisplay({ rateHoursPerMonth: 730.5 }), /월 기준 시간/)
})

test('★ 쓰는 값 셋은 그대로 통과한다', () => {
  for (const ok of [720, 730, 744]) {
    assert.equal(toRateDisplay({ rateHoursPerMonth: ok }).rateHoursPerMonth, ok)
  }
})

test('★ 비우면 null 이다 — 설정 기본값으로 떨어진다', () => {
  for (const empty of [null, undefined, '']) {
    assert.equal(toRateDisplay({ rateHoursPerMonth: empty }).rateHoursPerMonth, null)
  }
})

/* ── 기간 ────────────────────────────────────── */

test('★ 못 읽는 날짜는 거절한다 — 조용히 null 로 눕히지 않는다', () => {
  assert.throws(() => toDateOrNull('어제', 'startDate'), /날짜/)
  assert.throws(() => toDateOrNull('2026-13-45', 'startDate'), /날짜/)
})

test('★ 빈 값은 null 이다 — 끝이 협의 중인 견적이 있다', () => {
  for (const empty of [null, undefined, '']) {
    assert.equal(toDateOrNull(empty, 'endDate'), null)
  }
})

test('★ 읽은 날짜는 그 날이다', () => {
  const d = toDateOrNull('2026-10-07', 'startDate')
  assert.ok(d instanceof Date)
  assert.equal(d.toISOString().slice(0, 10), '2026-10-07')
})

/* ── 저장과 조회가 이어져 있나 ───────────────── */

test('★ 새 칸이 저장 목록과 조회 목록 양쪽에 있다', () => {
  const quoteFields = ['rateHoursPerMonth', 'rateAxisKeys', 'lineNoteKeys', 'totalConvKeys']
  for (const f of quoteFields) {
    assert.match(SERVICE, new RegExp(`'${f}'`), `QUOTE_KEYS 에 ${f} 가 없다 — 보내도 거절된다`)
    assert.match(SERVICE, new RegExp(`\\b${f}: true\\b`), `SELECT 에 ${f} 가 없다 — 저장돼도 안 돌아온다`)
  }
  for (const f of ['startDate', 'endDate']) {
    assert.match(SERVICE, new RegExp(`'${f}'`), `LINE_KEYS 에 ${f} 가 없다 — 보내도 조용히 버려진다`)
    assert.match(SERVICE, new RegExp(`\\b${f}: true`), `LINE_SELECT 에 ${f} 가 없다 — 저장돼도 안 돌아온다`)
  }
})

test('★ 모르는 이름은 그대로 거절된다', () => {
  // 화이트리스트를 느슨하게 바꾸면 단가 오타가 0원으로 조용히 들어가던 사고로 돌아간다
  assert.match(SERVICE, /function rejectUnknownKeys/, '화이트리스트 검사가 사라졌다')
  assert.match(SERVICE, /모르는 항목이 있습니다/, '거절 문구가 사라졌다')
})

test('★ 용어집 순서가 서버가 추리는 기준이다', () => {
  // 두 벌이 되면 화면이 보여 준 차례와 인쇄되는 차례가 갈린다
  assert.match(SERVICE, /RATE_AXIS_ORDER/, '서버가 용어집 순서를 안 쓴다')
  assert.ok(RATE_AXIS_ORDER.length === 3 && LINE_NOTE_ORDER.length === 4 && TOTAL_CONV_ORDER.length === 2)
})
