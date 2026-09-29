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
  embargoDays: 1,
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
  // Lockbox 20 + 학습 30 + 띄움 1 + 검증 3×10. 띄우는 날도 필요한 날에 든다
  const need = 20 + 30 + BASE.embargoDays + 3 * 10
  const plan = planned({ ...BASE, tradeDates: days(need) })
  assert.equal(plan.folds.length, 3)
  assert.equal(checkOrder(plan), null)
})


/* ── 학습과 검증 사이를 띄운다 (점검 2026-09-29) ── */

/**
 * **붙여 두면 라벨이 경계를 넘는다.**
 *
 * 라벨은 진입 뒤 손절·목표·시간청산 중 무엇이 먼저 닿았나다. 학습 마지막 날 늦게 연
 * 거래는 그 날 안에 안 끝날 수 있고, 붙어 있으면 그 결과가 검증 첫날 가격으로 정해진다.
 * 점검 전에는 `trainTo = dates[validateStart-1]` 로 **하루도 안 띄우고** 있었다.
 */
test('★ 학습 끝과 검증 시작 사이에 띄운 날이 있다', () => {
  const dates = days(100)
  for (const embargo of [1, 3, 5]) {
    const plan = planned({ ...BASE, embargoDays: embargo })
    for (const fold of plan.folds) {
      const gap = dates.filter((d) => d > fold.trainTo && d < fold.validateFrom).length
      assert.equal(gap, embargo, `${fold.index + 1}번째 접기가 ${gap}일만 띄웠다 (${embargo}일 필요)`)
      assert.ok(fold.trainTo < fold.validateFrom, '학습이 검증보다 뒤다')
    }
    assert.equal(plan.embargoDays, embargo, '계획이 띄운 날 수를 안 들고 다닌다')
  }
})

test('★ 띄우면 필요한 날이 그만큼 늘고, 모자라면 왜 모자란지 말한다', () => {
  // 100일에서 딱 맞던 설정이 띄움을 크게 주면 거절돼야 한다
  const tight = planWalkForward({ ...BASE, embargoDays: 30 })
  assert.ok('rejection' in tight, '자료가 모자란데 계획을 세운다')
  assert.match(tight.rejection.userMessage, /띄움|학습 구간/, '왜 모자란지를 안 말한다')
})

test('★ 띄울 날 수가 이상하면 계획을 안 세운다 — 조용히 0 으로 안 떨어진다', () => {
  for (const bad of [-1, 1.5, Number.NaN]) {
    const r = planWalkForward({ ...BASE, embargoDays: bad })
    assert.ok('rejection' in r, `띄움 ${bad} 인데 계획을 세운다`)
  }
  // 값을 아예 안 주면 undefined 라 그것도 거절이다 — 기본값을 여기서 지어내지 않는다
  const missing = planWalkForward({ ...BASE, embargoDays: undefined as unknown as number })
  assert.ok('rejection' in missing, '안 줬는데 0 으로 떨어진다')
})

test('★ checkOrder 가 실제로 띄워졌는지 센다 — 앞뒤 순서만으로는 모자라다', () => {
  const dates = days(100)
  const plan = planned({ ...BASE, embargoDays: 2 })
  assert.equal(checkOrder(plan, dates), null, '멀쩡한 계획을 막는다')

  // 학습 끝을 검증 시작 **직전**으로 도로 붙인 계획 (점검 전 동작)
  const glued = {
    ...plan,
    folds: plan.folds.map((f) => {
      const at = dates.indexOf(f.validateFrom)
      return { ...f, trainTo: dates[at - 1] }
    }),
  }
  const problem = checkOrder(glued, dates)
  assert.ok(problem, '하루도 안 띄운 계획이 통과한다')
  assert.match(problem.reason, /embargo_too_small/, '사유가 띄움 문제라고 안 말한다')
  assert.match(problem.userMessage, /학습에 들어갑니다/, '무엇이 문제인지 안 말한다')

  // 거래일을 안 주면 못 센다 — 그때는 앞뒤 순서만 본다(옛 부르는 자리가 안 깨진다)
  assert.equal(checkOrder(glued), null)
})
