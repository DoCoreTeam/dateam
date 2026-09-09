/**
 * 결과 피드백과 학습 루프 가드 (설계서 3.10.5)
 *
 * 여기서 잠그는 것 셋
 * - 표본 50건 미만이면 기본 가중치를 그대로 쓰는가
 * - 보정해도 안 나아지면 안 쓰는가
 * - 사용자 수정이 벤더 가중치와 매핑 사전에 반영되는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  calibrate, accuracy, pointBiserial, toCalibrationSamples,
  updateVendorWeights, updateMappingDictionary,
  MIN_CALIBRATION_SAMPLES, MIN_IMPROVEMENT, VENDOR_STEP,
  type CalibrationSample, type UserCorrection,
} from './calibrate.ts'
import { validateOutcome, wasCorrect, usableSamples, type JudgedCase } from './outcomes.ts'
import { SOFT_WEIGHTS } from '../fit/assess.ts'

/** 실적 점수가 높을수록 이긴 표본 — 실적 가중치가 올라가야 한다 */
function 표본(n: number): CalibrationSample[] {
  return Array.from({ length: n }, (_, i) => {
    const won = i % 2 === 0
    return {
      parts: {
        capability: won ? 34 : 20,
        trackRecord: won ? 24 : 5,
        scale: 12,
        risk: -3,
        competition: 5,
      },
      won,
    }
  })
}

const 판정 = (over: Partial<JudgedCase> = {}): JudgedCase => ({
  caseId: 'c1', verdict: 'full', score: 80,
  parts: { capability: 34, trackRecord: 24, scale: 12, risk: -3, competition: 5 },
  decision: 'go', result: 'won', submitted: true, ...over,
})

// 표본 하한

test('표본이 50건 미만이면 기본 가중치를 쓴다', () => {
  const r = calibrate(표본(MIN_CALIBRATION_SAMPLES - 1))
  // 적은 데이터로 고친 것이 안 고친 것보다 나쁘다
  assert.equal(r.adopted, false)
  assert.equal(r.reason, 'insufficient_samples')
  assert.deepEqual(r.weights, { ...SOFT_WEIGHTS })
})

test('표본이 없어도 안 죽는다', () => {
  const r = calibrate([])
  assert.equal(r.adopted, false)
  assert.equal(r.sampleSize, 0)
})

// 개선 없으면 안 씀

test('보정해도 안 나아지면 채택하지 않는다', () => {
  // 이기고 지는 것이 점수와 무관한 표본 — 어떤 가중치도 더 잘 맞히지 못한다
  const samples: CalibrationSample[] = Array.from({ length: 60 }, (_, i) => ({
    parts: { capability: 30, trackRecord: 15, scale: 10, risk: -5, competition: 5 },
    won: i % 3 === 0,
  }))
  const r = calibrate(samples)
  assert.equal(r.adopted, false)
  assert.equal(r.reason, 'no_improvement')
  // 보정한 것이 옛 가중치보다 못 맞히는 일이 실제로 있다
  assert.ok(r.calibratedAccuracy - r.baselineAccuracy < MIN_IMPROVEMENT)
  assert.deepEqual(r.weights, { ...SOFT_WEIGHTS })
})

test('보정 전후를 같은 표본으로 잰다', () => {
  const samples = 표본(60)
  const r = calibrate(samples)
  assert.equal(r.sampleSize, 60)
  assert.ok(r.baselineAccuracy >= 0 && r.baselineAccuracy <= 1)
  assert.ok(r.calibratedAccuracy >= 0 && r.calibratedAccuracy <= 1)
})

test('가중치가 절반에서 1.5배 안에서만 움직인다', () => {
  const r = calibrate(표본(80))
  for (const k of Object.keys(SOFT_WEIGHTS) as (keyof typeof SOFT_WEIGHTS)[]) {
    const base = Math.abs(SOFT_WEIGHTS[k])
    const got = Math.abs(r.weights[k])
    assert.ok(got >= base * 0.5 - 1 && got <= base * 1.5 + 1, `${k} 가 ${got} 로 범위를 벗어났다`)
    // 부호는 그대로 — 리스크는 여전히 빼는 항목이다
    assert.equal(Math.sign(r.weights[k]), Math.sign(SOFT_WEIGHTS[k]), `${k} 의 부호가 바뀌었다`)
  }
})

test('상관 계산이 값이 다 같으면 null 이다', () => {
  assert.equal(pointBiserial([1, 1, 1], [true, false, true]), null)
  assert.equal(pointBiserial([1, 2, 3], [true, true, true]), null)
  assert.equal(pointBiserial([], []), null)
  assert.ok((pointBiserial([1, 2, 3, 4], [false, false, true, true]) ?? 0) > 0)
})

test('정확도가 0~1 이다', () => {
  assert.equal(accuracy([], { ...SOFT_WEIGHTS }), 0)
  const a = accuracy(표본(10), { ...SOFT_WEIGHTS })
  assert.ok(a >= 0 && a <= 1)
})

// 정답지

test('참여한 사업만 판정의 증거다', () => {
  // 「부적합이라 해서 안 냈고 남이 따갔다」가 성공으로 잡히면 안 된다
  assert.equal(wasCorrect(판정({ submitted: false })), null)
  assert.equal(wasCorrect(판정({ submitted: true, result: 'won', verdict: 'full' })), true)
  assert.equal(wasCorrect(판정({ submitted: true, result: 'won', verdict: 'unfit' })), false)
  assert.equal(wasCorrect(판정({ submitted: true, result: 'cancelled' })), null)
})

test('쓸 수 있는 표본만 고른다', () => {
  const cases = [
    판정({ caseId: 'a', submitted: true, result: 'won' }),
    판정({ caseId: 'b', submitted: true, result: 'lost' }),
    판정({ caseId: 'c', submitted: false, result: 'lost' }),
    판정({ caseId: 'd', submitted: true, result: 'cancelled' }),
  ]
  assert.deepEqual(usableSamples(cases).map((c) => c.caseId), ['a', 'b'])
  assert.equal(toCalibrationSamples(cases).length, 2)
})

test('안 냈는데 순위가 있으면 잡는다', () => {
  const { problems } = validateOutcome({ decision: 'no_go', submitted: false, ourRank: 2 })
  // 받아 두면 「순위 2위인데 미제출」 같은 행이 통계에 섞인다
  assert.ok(problems.includes('rank_without_submit'))
})

test('모르는 결정과 결과를 잡되 죽지 않는다', () => {
  const { record, problems } = validateOutcome({ decision: '아마도', result: '몰라' })
  assert.deepEqual(problems.sort(), ['unknown_decision', 'unknown_result'])
  assert.equal(record.decision, 'undecided')
  assert.equal(record.result, null)
})

test('사람이 적은 것은 manual 로 남는다', () => {
  const { record } = validateOutcome({ decision: 'go', submitted: true, result: 'won' })
  assert.equal(record.source, 'manual')
})

// 사용자 수정 반영

test('사용자가 고른 벤더에 힘이 실린다', () => {
  const corrections: UserCorrection[] = [
    { fieldPath: 'budget.totalAmount', chosenVendor: 'A', rejectedVendor: 'B', mapping: null },
  ]
  const w = updateVendorWeights({ A: 1, B: 1 }, corrections)
  assert.equal(w.A, 1 + VENDOR_STEP)
  assert.equal(w.B, 1 - VENDOR_STEP)
})

test('벤더 가중치가 0.5~2.0 을 벗어나지 않는다', () => {
  const many: UserCorrection[] = Array.from({ length: 100 }, () => ({
    fieldPath: 'f', chosenVendor: 'A', rejectedVendor: 'B', mapping: null,
  }))
  const w = updateVendorWeights({ A: 1, B: 1 }, many)
  // 한 사용자가 몇 번 고른 것으로 한 벤더가 아예 안 쓰이면 잘하는 자리까지 잃는다
  assert.equal(w.A, 2)
  assert.equal(w.B, 0.5)
})

test('요건 매핑 사전이 갱신된다', () => {
  const dict = updateMappingDictionary({}, [{
    fieldPath: 'f', chosenVendor: null, rejectedVendor: null,
    mapping: { requirementText: '정보통신공사업 등록증 보유', type: 'business_registration' },
  }])
  // 사람이 고친 짝이 다음부터 자동으로 잡힌다
  assert.equal(dict['정보통신공사업등록증보유'], 'business_registration')
})

test('매핑이 없는 수정은 사전을 안 건드린다', () => {
  const dict = updateMappingDictionary({ 가: '나' }, [{
    fieldPath: 'f', chosenVendor: 'A', rejectedVendor: null, mapping: null,
  }])
  assert.deepEqual(dict, { 가: '나' })
})
