/**
 * 구간 나누기 — **학습은 언제나 검증보다 앞이다**
 *
 * 뒤집히면 그 모델은 답을 보고 문제를 푼 것이다. 그리고 그 실수는 조용히 일어난다 —
 * 날짜를 거꾸로 정렬하거나 마지막 구간을 학습으로 두면 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planWalkForward, checkOrder, type WalkForwardInput } from './windows.ts'

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`)
    .map((d, i) => {
      // 100일을 만들기 위해 달을 넘긴다
      const month = Math.floor(i / 28) + 1
      const day = (i % 28) + 1
      return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    })

const BASE: WalkForwardInput = {
  tradeDates: days(100), foldCount: 3, validateDays: 10, minTrainDays: 30, lockboxDays: 20,
}

function planned(input: WalkForwardInput) {
  const result = planWalkForward(input)
  assert.ok('plan' in result, '계획을 못 세웠다: ' + ('rejection' in result ? result.rejection.reason : ''))
  return result.plan
}

test('접기를 요청한 수만큼 만든다', () => {
  const plan = planned(BASE)
  assert.equal(plan.folds.length, 3)
  assert.deepEqual(plan.folds.map((f) => f.index), [0, 1, 2])
})

test('★ 모든 접기에서 학습이 검증보다 앞이다', () => {
  const plan = planned(BASE)
  for (const fold of plan.folds) {
    assert.ok(fold.trainTo < fold.validateFrom,
      `${fold.index}번째: 학습이 ${fold.trainTo} 까지인데 검증이 ${fold.validateFrom} 부터다`)
  }
  assert.equal(checkOrder(plan), null)
})

test('★ 뒤로 갈수록 학습 자료가 늘어난다 — 늘어나는 창이다', () => {
  const plan = planned(BASE)
  for (let i = 1; i < plan.folds.length; i += 1) {
    assert.ok(plan.folds[i].trainTo > plan.folds[i - 1].trainTo,
      `${i}번째 접기의 학습이 앞 접기보다 안 늘었다`)
  }
})

test('★ Lockbox 가 개발 구간과 안 겹친다 — 겹치면 이미 본 자료로 마지막 확인을 한다', () => {
  const plan = planned(BASE)
  assert.ok(plan.lockboxFrom > plan.developTo,
    `Lockbox 가 ${plan.lockboxFrom} 부터인데 개발 구간이 ${plan.developTo} 까지다`)
  assert.equal(checkOrder(plan), null)
})

test('검증 구간들이 서로 안 겹친다', () => {
  const plan = planned(BASE)
  for (let i = 1; i < plan.folds.length; i += 1) {
    assert.ok(plan.folds[i].validateFrom > plan.folds[i - 1].validateTo,
      `${i}번째 검증이 앞 검증과 겹친다`)
  }
})

test('★ 구간이 모자라면 접는 수를 줄이지 않고 거부한다 — 한 바퀴 돌고 워크포워드라 말하면 안 된다', () => {
  const result = planWalkForward({ ...BASE, tradeDates: days(40) })
  assert.ok('rejection' in result)
  assert.match(result.rejection.reason, /^not_enough_days:40</)
  assert.ok(result.rejection.userMessage.includes('최소'), '얼마나 모자란지가 문장에 없다')
})

test('접는 수가 0 이하면 거부한다', () => {
  const result = planWalkForward({ ...BASE, foldCount: 0 })
  assert.ok('rejection' in result)
  assert.equal(result.rejection.reason, 'fold_count_below_one')
})

test('★ 거래일이 중복되거나 정렬 안 돼 있으면 거부한다 — 거꾸로 정렬이 미래 학습의 흔한 경로다', () => {
  const unsorted = planWalkForward({ ...BASE, tradeDates: [...days(100)].reverse() })
  assert.ok('rejection' in unsorted)
  assert.equal(unsorted.rejection.reason, 'dates_not_unique_sorted')

  const dup = [...days(100)]
  dup[5] = dup[4]
  const duplicated = planWalkForward({ ...BASE, tradeDates: dup })
  assert.ok('rejection' in duplicated)
})

test('★ 순서 확인이 뒤집힌 계획을 잡는다', () => {
  const plan = planned(BASE)
  const broken = {
    ...plan,
    folds: plan.folds.map((f) => ({ ...f, trainTo: f.validateTo })),
  }
  const rejection = checkOrder(broken)
  assert.ok(rejection, '학습이 검증보다 뒤인데 통과했다')
  assert.ok(rejection.userMessage.includes('답을 보고'))
})

test('Lockbox 가 개발 구간을 덮으면 순서 확인이 잡는다', () => {
  const plan = planned(BASE)
  const rejection = checkOrder({ ...plan, lockboxFrom: plan.developFrom })
  assert.equal(rejection?.reason, 'lockbox_overlaps_develop')
})

test('딱 맞는 길이면 통과한다 — 경계에서 한 칸 차이로 거부하지 않는다', () => {
  const need = 20 + 30 + 3 * 10
  const plan = planned({ ...BASE, tradeDates: days(need) })
  assert.equal(plan.folds.length, 3)
  assert.equal(checkOrder(plan), null)
})
