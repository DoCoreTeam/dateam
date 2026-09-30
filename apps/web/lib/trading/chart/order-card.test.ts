import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOrderCard, ORDER_STEP_LABEL } from './order-card.ts'
import type { CallPlan } from './series.ts'

/** 실측 2026-09-30 오후 01:24 판단 (숏) 과 오후 01:15 판단 (롱) 값을 그대로 쓴다 */
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
  entryDeadlineAt: '2026-09-30T04:34:00.000Z',
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
const NOW = new Date('2026-09-30T04:27:40.000Z') // 오후 01:27:40
/** 실측 2026-09-30 trading_instruments MINI_KOSPI200 승수 */
const MULTIPLIER = 50_000

test('롱이면 사고 팔고 끊는 순서로 말한다', () => {
  const card = buildOrderCard({ plan: LONG, nowPrice: 1085.70, now: NOW })
  assert.equal(card.headline, '먼저 삽니다')
  assert.deepEqual(card.steps.map((s) => s.text), [
    '1086.64 에 삽니다',
    '1088.29 에 팝니다',
    '1085.32 에 끊습니다',
  ])
  assert.deepEqual(card.steps.map((s) => s.name), [
    ORDER_STEP_LABEL.entry, ORDER_STEP_LABEL.target, ORDER_STEP_LABEL.stop,
  ])
})

test('숏이면 팔고 되사고 끊는 순서로 말이 바뀐다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: NOW })
  assert.equal(card.headline, '먼저 팝니다')
  assert.deepEqual(card.steps.map((s) => s.text), [
    '1084.22 에 팝니다',
    '1082.75 에 되삽니다',
    '1085.40 에 끊습니다',
  ])
})

test('목표는 언제나 벌고 손절은 언제나 잃는다 — 방향이 반대여도 부호가 안 뒤집힌다', () => {
  for (const plan of [LONG, SHORT]) {
    const card = buildOrderCard({ plan, nowPrice: 1085.70, now: NOW, multiplier: MULTIPLIER })
    assert.match(card.steps[1].note ?? '', /^\+[\d,]+원$/, `${plan.direction} 목표`)
    assert.match(card.steps[2].note ?? '', /^-[\d,]+원$/, `${plan.direction} 손절`)
  }
})

test('점이 아니라 돈으로 말한다 — 승수를 곱해서', () => {
  // 실측 MINI_KOSPI200 승수 50,000원. 목표 1.47점 = 73,500원, 손절 1.18점 = 59,000원
  const card = buildOrderCard({ plan: SHORT, nowPrice: null, now: NOW, multiplier: MULTIPLIER })
  assert.equal(card.steps[1].note, '+73,500원')
  assert.equal(card.steps[2].note, '-59,000원')
})

test('승수를 모르면 돈을 지어내지 않고 점으로 돌아간다', () => {
  for (const m of [null, undefined, 0, Number.NaN]) {
    const card = buildOrderCard({ plan: SHORT, nowPrice: null, now: NOW, multiplier: m })
    assert.equal(card.steps[1].note, '+1.47점', `승수 ${String(m)}`)
    assert.equal(card.steps[2].note, '-1.18점', `승수 ${String(m)}`)
  }
})

test('들어갈 값 옆에는 지금 가격과의 거리가 붙는다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: NOW })
  assert.equal(card.steps[0].note, '지금보다 1.48점 아래')
  // 지금 가격을 모르면 거리를 지어내지 않는다
  assert.equal(buildOrderCard({ plan: SHORT, nowPrice: null, now: NOW }).steps[0].note, null)
})

test('들고 있는 시간은 길이와 시각 둘 다로 나온다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: NOW })
  const hold = card.times.find((t) => t.name === ORDER_STEP_LABEL.hold)
  assert.equal(hold?.text, '약 18분')
  // 지금 들어가면 01:27:40 + 18분 = 01:45
  assert.equal(hold?.note, '지금 들어가면 오후 01:45 쯤')
})

test('시각은 전부 시:분이고 길이로 안 적는다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: NOW })
  const by = card.times.find((t) => t.name === ORDER_STEP_LABEL.entryBy)
  assert.equal(by?.text, '오후 01:34 까지')
  assert.equal(by?.note, '6분 남음')
  const same = card.times.find((t) => t.name === ORDER_STEP_LABEL.sessionExit)
  assert.equal(same?.text, '오후 03:20')
})

test('시계가 없으면(서버 렌더) 남은 시간과 나올 시각을 안 적는다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: null })
  assert.equal(card.times.find((t) => t.name === ORDER_STEP_LABEL.entryBy)?.note, null)
  assert.equal(card.times.find((t) => t.name === ORDER_STEP_LABEL.hold)?.note, null)
  // 값은 그대로 나온다 — 시계가 없다고 계획을 비우지 않는다
  assert.equal(card.steps[0].text, '1084.22 에 팝니다')
})

test('주문서 안에는 점수가 없다 — 점수는 근거이지 주문이 아니다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: NOW, multiplier: MULTIPLIER })
  const all = [...card.steps, ...card.times].map((s) => `${s.name} ${s.text} ${s.note ?? ''}`).join(' ')
  assert.equal(all.includes('%'), false)
  assert.equal(all.includes('원점수'), false)
  assert.equal(all.includes('확률'), false)
})

test('마감이 지났으면 지났다고 말한다 — 지난 시각을 그대로 두지 않는다', () => {
  const late = new Date('2026-09-30T04:40:00.000Z')
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.70, now: late })
  assert.equal(card.times.find((t) => t.name === ORDER_STEP_LABEL.entryBy)?.note, '지났습니다')
})

test('돈은 화면에 뜬 가격으로 셈한다 — 보이는 값끼리 맞아떨어져야 한다', () => {
  // 1079.26 에서 1077.61 은 1.65점이고 승수 50,000 이면 82,500원이다.
  // 원값의 긴 소수로 곱하면 82,607원이 나와 화면과 안 맞는다 (실측 2026-09-30)
  const plan = { ...SHORT, referencePrice: 1079.2612, targetPrice: 1077.6091, stopPrice: 1080.5843 }
  const card = buildOrderCard({ plan, nowPrice: null, now: NOW, multiplier: MULTIPLIER })
  assert.equal(card.steps[1].text, '1077.61 에 되삽니다')
  assert.equal(card.steps[1].note, '+82,500원')
  assert.equal(card.steps[2].text, '1080.58 에 끊습니다')
  assert.equal(card.steps[2].note, '-66,000원')
})

/* ── 지나간 계획 (사용자 지적 2026-09-30 「디자인 정책좀 따르자 이게 뭐냐」) ── */

test('진입 시간이 지나면 지난 계획으로 표시한다', () => {
  const live = buildOrderCard({ plan: SHORT, nowPrice: 1085.7, now: NOW, multiplier: MULTIPLIER })
  assert.equal(live.past, false)
  const late = buildOrderCard({
    plan: SHORT, nowPrice: 1085.7, now: new Date('2026-09-30T04:40:00.000Z'), multiplier: MULTIPLIER,
  })
  assert.equal(late.past, true)
})

test('지난 계획에는 「지금 들어가면」을 안 적는다 — 그 시각엔 장이 없다', () => {
  // 실측 2026-09-30 오후 03:51 화면에 「지금 들어가면 오후 04:06 쯤」이 떠 있었다
  const late = buildOrderCard({
    plan: SHORT, nowPrice: 1085.7, now: new Date('2026-09-30T06:51:00.000Z'), multiplier: MULTIPLIER,
  })
  assert.equal(late.times.find((t) => t.name === ORDER_STEP_LABEL.hold)?.note, null)
  // 값 자체는 지우지 않는다 — 무엇을 말했었는지는 남아야 한다
  assert.equal(late.times.find((t) => t.name === ORDER_STEP_LABEL.hold)?.text, '약 18분')
})

test('당일 청산 시각이 지났으면 지났다고 적는다', () => {
  // 실측: 「늦어도 이때는 오후 03:20」이 오후 03:51 에 미래처럼 떠 있었다
  const late = buildOrderCard({
    plan: SHORT, nowPrice: 1085.7, now: new Date('2026-09-30T06:51:00.000Z'), multiplier: MULTIPLIER,
  })
  const same = late.times.find((t) => t.name === ORDER_STEP_LABEL.sessionExit)
  assert.equal(same?.text, '오후 03:20')
  assert.equal(same?.note, '지났습니다')
  // 아직 안 지났으면 원래 말을 한다
  const live = buildOrderCard({ plan: SHORT, nowPrice: 1085.7, now: NOW, multiplier: MULTIPLIER })
  assert.equal(live.times.find((t) => t.name === ORDER_STEP_LABEL.sessionExit)?.note, '그날 안에 정리합니다')
})

test('시계를 모르면 지났다고 말하지 않는다', () => {
  const card = buildOrderCard({ plan: SHORT, nowPrice: 1085.7, now: null, multiplier: MULTIPLIER })
  assert.equal(card.past, false)
  assert.equal(card.times.find((t) => t.name === ORDER_STEP_LABEL.sessionExit)?.note, '그날 안에 정리합니다')
})
