import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ONBOARDING_SEQUENCES,
  getSequence,
  findStepIndex,
  type OnboardingSequenceKey,
} from './steps.ts'

const KEYS: OnboardingSequenceKey[] = ['main', 'ai', 'gpu', 'weekly']

test('모든 시퀀스가 존재하고 최소 1스텝을 가진다', () => {
  for (const key of KEYS) {
    const seq = getSequence(key)
    assert.equal(seq.key, key)
    assert.ok(seq.steps.length >= 1, `${key} 시퀀스에 스텝이 없음`)
  }
})

test('시퀀스 내 스텝 key는 유일하다', () => {
  for (const key of KEYS) {
    const seq = getSequence(key)
    const keys = seq.steps.map((s) => s.key)
    assert.equal(new Set(keys).size, keys.length, `${key} 시퀀스에 중복 key`)
  }
})

test('entryRoute는 첫 스텝의 route와 같은 경로를 가리킨다', () => {
  for (const key of KEYS) {
    const seq = getSequence(key)
    // entryRoute는 쿼리스트링을 포함할 수 있으므로 pathname만 비교
    const entryPath = seq.entryRoute.split('?')[0]
    assert.equal(entryPath, seq.steps[0].route, `${key} entryRoute≠첫스텝 route`)
  }
})

test('gated 스텝은 반드시 interactionEvent를 가진다', () => {
  for (const key of KEYS) {
    for (const step of getSequence(key).steps) {
      if (step.gated) {
        assert.ok(
          step.interactionEvent && step.interactionEvent.length > 0,
          `${key}:${step.key} gated인데 interactionEvent 없음`,
        )
      }
    }
  }
})

test('element 없는 스텝(중앙 모달)도 route는 항상 존재한다', () => {
  for (const key of KEYS) {
    for (const step of getSequence(key).steps) {
      assert.ok(step.route && step.route.startsWith('/'), `${key}:${step.key} route 누락`)
      assert.ok(step.title.length > 0 && step.description.length > 0)
    }
  }
})

test('main 시퀀스는 일일 등록 실습(gated daily-saved)을 포함한다', () => {
  const main = getSequence('main')
  const daily = main.steps.find((s) => s.interactionEvent === 'daily-saved')
  assert.ok(daily, 'main에 daily-saved 게이팅 스텝 없음')
  assert.equal(daily?.gated, true)
  assert.equal(daily?.route, '/daily')
})

test('findStepIndex: 존재 key는 인덱스, 미존재/null은 0', () => {
  const main = getSequence('main')
  const second = main.steps[1].key
  assert.equal(findStepIndex(main, second), 1)
  assert.equal(findStepIndex(main, null), 0)
  assert.equal(findStepIndex(main, 'no-such-key'), 0)
})

test('ONBOARDING_SEQUENCES는 4개 시퀀스를 노출한다', () => {
  assert.deepEqual(Object.keys(ONBOARDING_SEQUENCES).sort(), [...KEYS].sort())
})
