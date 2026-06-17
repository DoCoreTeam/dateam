import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getLocalCache,
  isOnboardingActive,
  setOnboardingActive,
} from './onboarding-state.ts'

// node:test 환경엔 window가 없다 → SSR-safe 분기(typeof window === 'undefined')를 검증한다.

test('SSR 환경에서 getLocalCache는 기본값(done:false, step:null)을 반환', () => {
  const cache = getLocalCache()
  assert.equal(cache.done, false)
  assert.equal(cache.step, null)
})

test('SSR 환경에서 isOnboardingActive는 false', () => {
  assert.equal(isOnboardingActive(), false)
})

test('SSR 환경에서 setOnboardingActive는 throw하지 않고 no-op', () => {
  assert.doesNotThrow(() => setOnboardingActive(true))
  assert.equal(isOnboardingActive(), false)
})
