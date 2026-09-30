import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entryWindowNow, ENTRY_VERDICT_TEXT } from './entry-window.ts'
import type { CallPlan } from './series.ts'

/** 실측 2026-09-30 오후 01:24 판단 (숏) */
const SHORT: CallPlan = {
  direction: 'short',
  barAt: '2026-09-30T04:24:00.000Z',
  referencePrice: 1084.22,
  stopPrice: 1085.40,
  targetPrice: 1082.75,
  chaseLimitPrice: 1083.93,
  timeExitMinutes: 18,
  sameDayExitAt: '2026-09-30T06:20:00.000Z',
  validMinutes: 10,
  entryDeadlineAt: '2026-09-30T04:34:00.000Z', // 오후 01:34
  from: 'preview',
}
const LONG: CallPlan = {
  ...SHORT,
  direction: 'long',
  referencePrice: 1086.64,
  stopPrice: 1085.32,
  targetPrice: 1088.29,
  chaseLimitPrice: 1086.97,
}
const IN_TIME = new Date('2026-09-30T04:27:40.000Z') // 오후 01:27:40
const PAST = new Date('2026-09-30T04:34:00.000Z')    // 마감 그 순간

test('아직 괜찮으면 들어가도 된다고 말하고 기준가와의 거리를 적는다', () => {
  const w = entryWindowNow({ plan: SHORT, nowPrice: 1085.70, now: IN_TIME })
  assert.equal(w.verdict, 'ok')
  assert.equal(w.text, ENTRY_VERDICT_TEXT.ok)
  assert.equal(w.note, '기준가 1084.22 와 1.48점 차이입니다')
})

test('숏은 한계가 밑으로 내려가면 따라가지 말라고 한다', () => {
  const w = entryWindowNow({ plan: SHORT, nowPrice: 1083.43, now: IN_TIME })
  assert.equal(w.verdict, 'beyond_chase')
  assert.equal(w.text, ENTRY_VERDICT_TEXT.beyond_chase)
  assert.equal(w.note, '한계가 1083.93 를 0.50점 밑돕니다')
  // 경계 그 값은 아직 괜찮다 — 넘은 것이 아니다
  assert.equal(entryWindowNow({ plan: SHORT, nowPrice: 1083.93, now: IN_TIME }).verdict, 'ok')
})

test('롱은 한계가 위로 올라가면 따라가지 말라고 한다', () => {
  const w = entryWindowNow({ plan: LONG, nowPrice: 1087.50, now: IN_TIME })
  assert.equal(w.verdict, 'beyond_chase')
  assert.equal(w.note, '한계가 1086.97 를 0.53점 넘었습니다')
  assert.equal(entryWindowNow({ plan: LONG, nowPrice: 1086.97, now: IN_TIME }).verdict, 'ok')
  // 같은 가격이라도 방향이 반대면 판정이 반대다
  assert.equal(entryWindowNow({ plan: LONG, nowPrice: 1080.00, now: IN_TIME }).verdict, 'ok')
  assert.equal(entryWindowNow({ plan: SHORT, nowPrice: 1080.00, now: IN_TIME }).verdict, 'beyond_chase')
})

test('마감을 한계가보다 먼저 본다 — 시간이 지났으면 가격이 좋아도 지난 것이다', () => {
  // 가격은 아직 한계가 안이지만 마감 시각이다
  const w = entryWindowNow({ plan: SHORT, nowPrice: 1085.70, now: PAST })
  assert.equal(w.verdict, 'too_late')
  assert.equal(w.note, '다음 판단을 기다리세요')
  // 한계가도 넘고 시간도 지났으면 시간이 먼저다
  const both = entryWindowNow({ plan: SHORT, nowPrice: 1080.00, now: PAST })
  assert.equal(both.verdict, 'too_late')
})

test('값이 없으면 된다고 말하지 않는다', () => {
  const noPrice = entryWindowNow({ plan: SHORT, nowPrice: null, now: IN_TIME })
  assert.equal(noPrice.verdict, 'unknown')
  assert.equal(noPrice.note, '지금 가격을 못 받았습니다')

  const noLimit = entryWindowNow({ plan: { ...SHORT, chaseLimitPrice: null }, nowPrice: 1085.7, now: IN_TIME })
  assert.equal(noLimit.verdict, 'unknown')
  assert.equal(noLimit.note, '이 계획에는 진입 한계가가 없습니다')

  // 시계가 없으면(서버 렌더) 판정을 미룬다 — 「됩니다」도 「지났습니다」도 아니다
  const noClock = entryWindowNow({ plan: SHORT, nowPrice: 1085.7, now: null })
  assert.equal(noClock.verdict, 'unknown')
  for (const w of [noPrice, noLimit, noClock]) {
    assert.equal(w.text.includes('됩니다'), false, '모르는데 된다고 말한다')
  }
})
