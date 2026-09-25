/**
 * 보정 — **확률을 내놓는 것과 그 확률이 맞는 것은 다른 일이다**
 *
 * 판단기의 0.72 는 확률이 아니다. 「0.72 라고 말한 과거 신호들 중 실제로 이긴 비율」이
 * 확률이고, 그것을 맞추는 것이 보정이다. 보정이 없으면 기대값을 못 내고, 그래서
 * 보정 없이는 신호를 안 낸다(M3).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitPlatt, applyPlatt, chooseMethod, validateWindows, type LabeledScore } from './platt.ts'
import {
  brierScore, baseRateBrier, reliabilityCurve, isMonotonic, judgeCalibration,
  type ProbabilityOutcome,
} from './metrics.ts'

/** 점수가 높을수록 실제로 잘 이기는 자료 — 보정이 배울 것이 있는 경우 */
function informativeSamples(n: number): LabeledScore[] {
  const out: LabeledScore[] = []
  for (let i = 0; i < n; i += 1) {
    const score = (i % 10) / 10 + 0.05
    // 점수가 높을수록 이길 확률이 높게, 결정론적으로 만든다
    const win = (i % 10) >= 5 ? (i % 3 !== 0) : (i % 4 === 0)
    out.push({ score, win })
  }
  return out
}

test('★ 표본이 모자라거나 한쪽 답만 있으면 못 맞춘다 — 억지로 맞추면 전부 이긴다는 모델이 나온다', () => {
  assert.equal(fitPlatt([]), null)
  assert.equal(fitPlatt([{ score: 0.5, win: true }]), null)
  assert.equal(fitPlatt([{ score: 0.5, win: true }, { score: 0.6, win: true }]), null, '전부 이긴 자료로 맞췄다')
  assert.equal(fitPlatt([{ score: 0.5, win: false }, { score: 0.6, win: false }]), null)
})

test('★ 점수가 높을수록 보정 확률도 높아진다', () => {
  const params = fitPlatt(informativeSamples(400))
  assert.ok(params, '맞추지 못했다')
  const low = applyPlatt(params, 0.15)
  const high = applyPlatt(params, 0.95)
  assert.ok(high > low, `높은 점수(${high})가 낮은 점수(${low})보다 확률이 안 높다`)
})

test('★ 보정 확률이 0 과 1 사이에 있다 — 양끝에 붙으면 기대값 계산이 무너진다', () => {
  const params = fitPlatt(informativeSamples(400))
  assert.ok(params)
  for (const score of [-5, 0, 0.5, 1, 5]) {
    const p = applyPlatt(params, score)
    assert.ok(p > 0 && p < 1, `${score} 의 확률이 ${p} 다`)
  }
})

test('보정은 결정론적이다 — 같은 자료에 같은 파라미터', () => {
  const samples = informativeSamples(200)
  assert.deepEqual(fitPlatt(samples), fitPlatt(samples))
})

test('★ 표본이 기준 미만이면 등위 회귀를 안 쓴다 (D-42)', () => {
  assert.equal(chooseMethod(999, 1_000), 'platt')
  assert.equal(chooseMethod(1_000, 1_000), 'isotonic')
  assert.equal(chooseMethod(0, 1_000), 'platt')
})

test('★ 학습 구간이 검증 구간과 겹치면 거부한다 — 자기 답을 보고 푸는 것이다', () => {
  const base = { samples: informativeSamples(10) }
  const overlap = validateWindows({
    ...base, trainFrom: '2026-01-01', trainTo: '2026-06-30',
    validateFrom: '2026-06-01', validateTo: '2026-09-30',
  })
  assert.ok(overlap)
  assert.match(overlap.reason, /^windows_overlap/)

  const ok = validateWindows({
    ...base, trainFrom: '2026-01-01', trainTo: '2026-05-31',
    validateFrom: '2026-06-01', validateTo: '2026-09-30',
  })
  assert.equal(ok, null)
})

test('표본이 없으면 거부한다', () => {
  const rejected = validateWindows({
    samples: [], trainFrom: '2026-01-01', trainTo: '2026-05-31',
    validateFrom: '2026-06-01', validateTo: '2026-09-30',
  })
  assert.equal(rejected?.reason, 'no_samples')
})

// ── 보정이 쓸 만한가 ─────────────────────────────────────

const outcome = (prob: number, win: boolean): ProbabilityOutcome => ({ prob, win })

test('Brier 는 확률과 실제의 제곱 오차 평균이다', () => {
  assert.equal(brierScore([outcome(1, true), outcome(0, false)]), 0, '완벽히 맞히면 0')
  assert.equal(brierScore([outcome(0, true), outcome(1, false)]), 1, '완전히 틀리면 1')
  assert.equal(brierScore([]), null, '표본이 없으면 0 이 아니라 null 이다')
})

test('★ 기저율보다 나쁘면 그 보정은 아무 정보도 안 준다', () => {
  // 절반이 이긴 자료. 기저율 모델은 늘 0.5 를 답한다 → Brier 0.25
  const outcomes = [outcome(0.9, true), outcome(0.9, true), outcome(0.1, false), outcome(0.1, false)]
  assert.equal(baseRateBrier(outcomes), 0.25)
  const verdict = judgeCalibration(outcomes, { minSamples: 1 })
  assert.equal(verdict.betterThanBaseRate, true)

  // 거꾸로 말하는 모델
  const backwards = [outcome(0.1, true), outcome(0.1, true), outcome(0.9, false), outcome(0.9, false)]
  assert.equal(judgeCalibration(backwards, { minSamples: 1 }).betterThanBaseRate, false)
})

test('보정 곡선이 구간별 실제 승률을 준다', () => {
  const curve = reliabilityCurve([
    outcome(0.05, false), outcome(0.15, false),
    outcome(0.85, true), outcome(0.95, true),
  ], 10)
  assert.equal(curve.length, 10)
  assert.equal(curve[0].count, 1)
  assert.equal(curve[0].actualRate, 0)
  assert.equal(curve[9].actualRate, 1)
})

test('★ 표본이 없는 구간은 0 이 아니라 null — 0 으로 읽으면 곡선이 내려간 것처럼 보인다', () => {
  const curve = reliabilityCurve([outcome(0.95, true)], 10)
  assert.equal(curve[0].actualRate, null)
  assert.equal(curve[0].count, 0)
  // 그 null 때문에 오름차순 판정이 틀리지 않는다
  assert.equal(isMonotonic(curve), true)
})

test('구간 승률이 내려가면 오름차순이 아니다', () => {
  const curve = reliabilityCurve([
    outcome(0.05, true), outcome(0.15, true),
    outcome(0.85, false), outcome(0.95, false),
  ], 10)
  assert.equal(isMonotonic(curve), false)
})

test('★ 표본이 모자라면 「나쁨」이 아니라 「아직 못 잼」이다', () => {
  const verdict = judgeCalibration([outcome(0.9, true)], { minSamples: 100 })
  assert.equal(verdict.insufficient, true, '표본 1건으로 판정을 내렸다')

  const enough = judgeCalibration(
    Array.from({ length: 100 }, (_, i) => outcome(i % 2 ? 0.9 : 0.1, i % 2 === 1)),
    { minSamples: 100 },
  )
  assert.equal(enough.insufficient, false)
})
