// analyze-runner.ts 순수 로직 단위테스트. drainSession/claimItems/deriveProgress는 Supabase admin
// client가 필요해 여기서 다루지 않음(§ 제약: package.json 등록 없이 node:test 직접 실행만 가능).
// 실행: node --test --experimental-strip-types "lib/ai-chat/analyze-runner.test.ts"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concurrencyFromMeta } from './analyze-runner.ts'

test('concurrencyFromMeta: 미설정이면 기본값 4', () => {
  assert.equal(concurrencyFromMeta({}), 4)
})

test('concurrencyFromMeta: 숫자값 그대로 사용', () => {
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: 8 }), 8)
})

test('concurrencyFromMeta: 문자열 숫자도 파싱', () => {
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: '6' }), 6)
})

test('concurrencyFromMeta: 0 이하/비정상 값은 기본값 폴백', () => {
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: 0 }), 4)
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: -3 }), 4)
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: 'abc' }), 4)
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: null }), 4)
})

test('concurrencyFromMeta: 소수는 내림', () => {
  assert.equal(concurrencyFromMeta({ ai_analysis_concurrency: 5.9 }), 5)
})
