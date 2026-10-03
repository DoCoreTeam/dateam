/**
 * 활동 지표 — **무엇을 세고 무엇을 안 세나**
 *
 * 특히 보는 둘:
 *   · 기간을 **일어난 날**로 자른다. 적은 날로 자르면 「지난주 접촉」이 적은 사람의
 *     부지런함을 재는 숫자가 된다.
 *   · 시스템이 남긴 기록을 접촉으로 세지 않는다. 실측 2026-10-02 에 421건 중 23건이
 *     SYSTEM 이었고, 그것까지 세면 사람이 한 일보다 큰 숫자가 나온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runActivityMetric, isActivityAxis, ACTIVITY_AXES,
  type LoadedActivities, type MetricActivity,
} from './activity-metrics.ts'
import type { Period } from '../domain/target.ts'
/*
  **칸 열쇠는 엔진에서 가져온다.** 시험이 제 열쇠를 지어 쓰면 구현이 그 열쇠를 바꿔도
  초록이 뜬다 — 실제로 그랬다(2026-10-04: 시험 통과, 화면의 교차표는 전부 「—」).
*/
import { ALL_KEY, CELL_SEP } from '../domain/metric-agg.ts'

const Q3_2026: Period = { kind: 'QUARTER', year: 2026, index: 3 }
const Y2026: Period = { kind: 'YEAR', year: 2026 }

function act(id: string, type: string, occurredAt: string, createdById: string | null = 'm_1'): MetricActivity {
  return { id, type, occurredAt: new Date(occurredAt), createdById }
}

function loaded(items: MetricActivity[], names: [string, string][] = [['m_1', '김영업'], ['m_2', '박지원']]): LoadedActivities {
  return { items, truncated: false, memberNames: new Map(names) }
}

// ------------------------------------------------------------
// 기간 — 일어난 날로 자른다
// ------------------------------------------------------------

test('★ 기간은 일어난 날로 자른다', () => {
  const data = loaded([
    act('a', 'CALL', '2026-08-28T05:00:00Z'),
    act('b', 'CALL', '2026-10-02T05:00:00Z'),
  ])
  const q3 = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026 })
  assert.equal(q3.total.count, 1, '3분기 밖의 것이 섞였다')
  assert.equal(q3.dateBasis, 'occurredAt', '화면이 「기준 · 일어난 날」이라고 말할 근거다')
  assert.equal(q3.from, '2026-07-01')
  assert.equal(q3.to, '2026-09-30')
})

test('★ KST 로 자른다 — 한국 시간 자정 전후가 하루 밀리지 않는다', () => {
  /*
    9월 30일 23시 30분 KST = 9월 30일 14:30 UTC. UTC 날짜로 자르면 그대로 9월이지만,
    10월 1일 0시 30분 KST = 9월 30일 15:30 UTC 는 **UTC 로는 9월**이라 3분기에 섞인다.
  */
  const data = loaded([
    act('in', 'CALL', '2026-09-30T14:30:00Z'),
    act('out', 'CALL', '2026-09-30T15:30:00Z'),
  ])
  const q3 = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026 })
  assert.equal(q3.total.count, 1, 'KST 10월 1일 것이 3분기에 섞였다')
})

// ------------------------------------------------------------
// 시스템과 사람
// ------------------------------------------------------------

test('★ 시스템이 남긴 기록을 접촉으로 세지 않는다', () => {
  const data = loaded([
    act('n', 'NOTE', '2026-08-01T01:00:00Z'),
    act('c', 'CALL', '2026-08-02T01:00:00Z'),
    act('m', 'MEETING', '2026-08-03T01:00:00Z'),
    act('e', 'EMAIL', '2026-08-04T01:00:00Z'),
    act('s1', 'SYSTEM', '2026-08-05T01:00:00Z', null),
    act('s2', 'SYSTEM', '2026-08-06T01:00:00Z', null),
  ])
  const all = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026 })
  const contact = runActivityMetric(data, { metric: 'contact_count', period: Q3_2026 })

  assert.equal(all.total.count, 6, '활동 건수는 시스템까지 센다')
  assert.equal(contact.total.count, 4, '접촉 건수는 시스템을 뺀다')
  assert.equal(all.total.count - contact.total.count, 2, '뺀 수가 시스템 건수와 같아야 한다')
})

test('메일은 사람이 남긴 것으로 센다 — 편지를 보낸 것은 사람이다', () => {
  const data = loaded([act('e', 'EMAIL', '2026-08-04T01:00:00Z')])
  assert.equal(runActivityMetric(data, { metric: 'contact_count', period: Q3_2026 }).total.count, 1)
})

// ------------------------------------------------------------
// 축 — 칸 합이 전체와 같다
// ------------------------------------------------------------

test('★ 종류 축으로 쪼개도 칸 합이 전체와 같다', () => {
  const data = loaded([
    act('a', 'NOTE', '2026-08-01T01:00:00Z'),
    act('b', 'NOTE', '2026-08-02T01:00:00Z'),
    act('c', 'CALL', '2026-08-03T01:00:00Z'),
    act('d', 'SYSTEM', '2026-08-04T01:00:00Z', null),
  ])
  const r = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026, rows: 'activityType' })
  const sum = Object.values(r.cells).reduce((acc, c) => acc + c.count, 0)
  assert.equal(sum, r.total.count, '쪼갠 칸의 합이 전체와 다르면 어느 쪽도 못 믿는다')
  assert.equal(r.rows.length, 3, '노트·통화·시스템 세 줄')
  assert.deepEqual(r.rows.map((x) => x.label), ['노트', '시스템', '통화'], '이름순이다')
})

test('★ 남긴 사람 축에 id 가 아니라 이름이 뜬다', () => {
  const data = loaded([
    act('a', 'CALL', '2026-08-01T01:00:00Z', 'm_1'),
    act('b', 'CALL', '2026-08-02T01:00:00Z', 'm_2'),
    act('c', 'CALL', '2026-08-03T01:00:00Z', 'm_2'),
  ])
  const r = runActivityMetric(data, { metric: 'contact_count', period: Q3_2026, rows: 'activityAuthor' })
  assert.deepEqual(r.rows.map((x) => x.label), ['김영업', '박지원'])
  assert.equal(r.cells[`m_2${CELL_SEP}${ALL_KEY}`].count, 2, '화면이 찾는 열쇠로 칸이 들어 있어야 한다')
  assert.equal(Object.values(r.cells).reduce((a, c) => a + c.count, 0), 3)
})

test('사람을 모르는 기록은 「없음」 한 줄로 모인다 — 숨기면 합이 안 맞는다', () => {
  const data = loaded([
    act('a', 'CALL', '2026-08-01T01:00:00Z', 'm_1'),
    act('s', 'SYSTEM', '2026-08-02T01:00:00Z', null),
  ])
  const r = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026, rows: 'activityAuthor' })
  assert.equal(r.rows.length, 2)
  assert.ok(r.rows.some((x) => x.label === '없음'))
  assert.equal(Object.values(r.cells).reduce((a, c) => a + c.count, 0), 2)
})

test('★ 두 축으로 쪼개도 칸 합이 전체와 같다', () => {
  const data = loaded([
    act('a', 'NOTE', '2026-08-01T01:00:00Z', 'm_1'),
    act('b', 'CALL', '2026-08-02T01:00:00Z', 'm_1'),
    act('c', 'CALL', '2026-09-03T01:00:00Z', 'm_2'),
  ])
  const r = runActivityMetric(data, {
    metric: 'contact_count', period: Q3_2026, rows: 'activityAuthor', cols: 'activityType',
  })
  assert.equal(Object.values(r.cells).reduce((a, c) => a + c.count, 0), 3)
  assert.equal(r.rows.length, 2)
  assert.equal(r.cols.length, 2)
})

test('시간 축으로 쪼개면 시간순이다', () => {
  const data = loaded([
    act('a', 'CALL', '2026-02-01T01:00:00Z'),
    act('b', 'CALL', '2026-08-01T01:00:00Z'),
    act('c', 'CALL', '2026-11-01T01:00:00Z'),
  ])
  const r = runActivityMetric(data, { metric: 'activity_count', period: Y2026, rows: 'quarter' })
  assert.deepEqual(r.rows.map((x) => x.label), ['2026년 1분기', '2026년 3분기', '2026년 4분기'])
})

// ------------------------------------------------------------
// 금액이 없다는 사실
// ------------------------------------------------------------

test('★ 칸 열쇠가 딜 엔진과 같은 규약이다 — 화면이 두 엔진을 같은 코드로 그린다', () => {
  const data = loaded([act('a', 'CALL', '2026-08-01T01:00:00Z', 'm_1')])
  const r = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026, rows: 'activityAuthor' })
  const key = `m_1${CELL_SEP}${ALL_KEY}`
  assert.ok(key in r.cells, `화면은 ${key} 로 칸을 찾는다. 열쇠가 다르면 표가 전부 「—」가 된다`)
  assert.equal(r.cols[0].key, ALL_KEY, '축을 안 고르면 한 칸이고 그 이름도 엔진 규약을 쓴다')
})

test('활동에는 금액이 없다 — 0 원이라고 적지 않는다', () => {
  const data = loaded([act('a', 'CALL', '2026-08-01T01:00:00Z')])
  const r = runActivityMetric(data, { metric: 'activity_count', period: Q3_2026 })
  assert.deepEqual(r.total.byCurrency, {}, '빈 칸이어야 한다. 0 을 넣으면 화면이 0 원을 그린다')
  assert.equal(r.notes.mixedCurrency, false)
  assert.equal(r.notes.unknownProbability, 0, '활동에는 성사확률이 없다')
  assert.equal(r.unit, 'count')
})

test('축 이름이 활동 축인지 아는 자리가 하나다', () => {
  assert.equal(isActivityAxis('activityType'), true)
  assert.equal(isActivityAxis('activityAuthor'), true)
  assert.equal(isActivityAxis('stage'), false)
  assert.equal(isActivityAxis(null), false)
  assert.deepEqual(ACTIVITY_AXES.map((a) => a.label), ['종류', '남긴 사람'])
})

test('모르는 지표를 주면 그 자리에서 멈춘다 — 빈 결과로 위장하지 않는다', () => {
  assert.throws(() => runActivityMetric(loaded([]), { metric: 'telepathy', period: Q3_2026 }), /지표/)
})
