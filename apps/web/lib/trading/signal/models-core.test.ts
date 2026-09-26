import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  directionOf, scoreForDirection, plattParamsFrom, probabilitiesFrom,
  type SignalModels,
} from './models-core.ts'
import type { EvModel } from '../ev/model.ts'
import type { RawScore } from '../judge/types.ts'

const score = (long: number, short: number, hold: number, enterNow = 0.8): RawScore =>
  ({ p_long: long, p_short: short, p_hold: hold, enter_now: enterNow }) as RawScore

test('★ 관망이 가장 높으면 방향이 없다 — 판단기가 모르겠다고 한 것을 우리가 뒤집지 않는다', () => {
  assert.equal(directionOf(score(0.3, 0.2, 0.5)), null)
  // 동점이어도 관망 쪽이다. 억지로 고르면 반반인 날마다 들어간다
  assert.equal(directionOf(score(0.4, 0.2, 0.4)), null)
})

test('관망이 아니면 큰 쪽이 방향이다', () => {
  assert.equal(directionOf(score(0.6, 0.2, 0.2)), 'long')
  assert.equal(directionOf(score(0.2, 0.6, 0.2)), 'short')
})

test('★ 원점수가 숫자가 아니면 방향이 없다', () => {
  assert.equal(directionOf(score(Number.NaN, 0.2, 0.2)), null)
  assert.equal(directionOf(null), null)
})

test('고른 방향의 원점수를 꺼낸다', () => {
  assert.equal(scoreForDirection(score(0.6, 0.3, 0.1), 'long'), 0.6)
  assert.equal(scoreForDirection(score(0.6, 0.3, 0.1), 'short'), 0.3)
})

test('★ 보정 파라미터가 숫자가 아니면 모델 없음이다 — NaN 은 비교가 전부 거짓이라 사유 없이 막힌다', () => {
  assert.deepEqual(plattParamsFrom({ a: -2, b: 1 }), { a: -2, b: 1 })
  assert.equal(plattParamsFrom({ a: '-2', b: 1 }), null)
  assert.equal(plattParamsFrom({ a: -2 }), null)
  assert.equal(plattParamsFrom(null), null)
  assert.equal(plattParamsFrom('platt'), null)
})

// ── 순서대로만 (M2) ───────────────────────────────────────

const evModel = (meanR: number | null, samples = 50): EvModel => ({
  version: 'ev-1', judge: 'rule', direction: 'long',
  buckets: [
    { from: 0, to: 0.5, sampleCount: samples, meanNetPnlR: -0.2 },
    { from: 0.5, to: 1, sampleCount: samples, meanNetPnlR: meanR },
  ],
  trainFrom: '2026-01-01', trainTo: '2026-06-30',
})

const models = (over: Partial<SignalModels> = {}): SignalModels => ({
  direction: 'long',
  calibration: { params: { a: -8, b: 3 }, version: 'cal-1' },
  ev: { model: evModel(0.35), version: 'ev-1' },
  enterNowCalibration: { params: { a: -8, b: 3 }, version: 'cal-1' },
  ...over,
})

test('원점수가 없으면 no_score 에서 멈춘다', () => {
  const r = probabilitiesFrom(null, models())
  assert.equal(r.stoppedAt, 'no_score')
  assert.equal(r.calibratedProb, null)
})

test('관망이면 hold_dominant 에서 멈춘다', () => {
  assert.equal(probabilitiesFrom(score(0.2, 0.2, 0.6), models()).stoppedAt, 'hold_dominant')
})

test('★ 보정이 없으면 거기서 멈춘다 — 원점수는 확률이 아니다 (M3)', () => {
  const r = probabilitiesFrom(score(0.9, 0.05, 0.05), models({ calibration: null }))
  assert.equal(r.stoppedAt, 'no_calibration')
  assert.equal(r.calibratedProb, null)
  assert.equal(r.netExpectedValueR, null)
  assert.equal(r.direction, 'long')
})

test('★ 모델이 다른 방향 것이면 안 쓴다 — 숏 모델로 롱을 보정하지 않는다', () => {
  const r = probabilitiesFrom(score(0.9, 0.05, 0.05), models({ direction: 'short' }))
  assert.equal(r.stoppedAt, 'no_calibration')
})

test('보정이 있으면 확률과 판 번호가 나온다', () => {
  const r = probabilitiesFrom(score(0.9, 0.05, 0.05), models())
  assert.ok(r.calibratedProb !== null && r.calibratedProb > 0.5, `확률 ${r.calibratedProb}`)
  assert.equal(r.calibrationVersion, 'cal-1')
  assert.ok(r.enterNowProb !== null)
  assert.equal(r.netExpectedValueR, 0.35)
  assert.equal(r.evModelVersion, 'ev-1')
  assert.equal(r.stoppedAt, null)
})

test('★ 기대값 구간이 비었으면 보정은 남기고 기대값만 없다 — 어디서 막혔는지가 남는다', () => {
  const r = probabilitiesFrom(score(0.9, 0.05, 0.05), models({
    ev: { model: evModel(null), version: 'ev-1' },
  }))
  assert.ok(r.calibratedProb !== null)
  assert.equal(r.netExpectedValueR, null)
  assert.equal(r.evModelVersion, null)
  assert.equal(r.stoppedAt, 'no_ev_bucket')
})

test('기대값 표본이 기준보다 적으면 그 구간은 안 쓴다', () => {
  const r = probabilitiesFrom(score(0.9, 0.05, 0.05), models({
    ev: { model: evModel(0.35, 3), version: 'ev-1' },
  }), 10)
  assert.equal(r.netExpectedValueR, null)
  assert.equal(r.stoppedAt, 'no_ev_bucket')
})

test('enter_now 가 숫자가 아니면 그 확률만 없다 — 방향 보정은 살아 있다', () => {
  const bad = { p_long: 0.9, p_short: 0.05, p_hold: 0.05, enter_now: Number.NaN } as RawScore
  const r = probabilitiesFrom(bad, models())
  assert.equal(r.enterNowProb, null)
  assert.ok(r.calibratedProb !== null)
})
