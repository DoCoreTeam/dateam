/**
 * 못 만든 절의 사유를 제대로 접는지 본다
 *
 * **왜**: 이 모듈은 두 가지를 동시에 지킨다 —
 * ① 밖에서 온 문구가 화면으로 새지 않게 하고 ② 사람이 다음에 할 일을 가른다.
 * 둘 다 «문자열을 어떻게 읽었나»에 달려 있어서, 실제로 받은 문구를 그대로 넣어 본다.
 * 지어낸 문구로만 시험하면 정작 운영에서 오는 모양은 한 번도 안 지난다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure, missingSections } from './failure-reason.ts'

/** 2026-09-22 케이스 e3338eb6 의 잡 기록에서 그대로 가져온 문구 */
const REAL_TOO_LARGE =
  "no usable model (3 tried): 429 Request too large for model `qwen/qwen3.8-27b` in organization " +
  "`org_01EXAMPLEORGID000000000` service tier `on_demand` on output tokens per minute (OTPM): " +
  "Limit 1000, Requested 1333. The request's expected output tokens exceed the enforced limit; " +
  'reduce max_tokens (or the request\'s expected output) and try again. Need more tokens? ' +
  'Upgrade to Dev Tier today at https://console.groq.com/settings/billing'

const REAL_NO_CREDIT =
  '429 You have no credits remaining. Add credits to continue using the API at https://console.groq.com/settings/billing'

const REAL_BUDGET_DENIED =
  'ai_budget_denied(per_minute): AI 분당 한도 · ai-chat 방금 7/5회 — 5초 뒤에 다시 됩니다.'

test('429 와 too large 가 같이 오면 too_large 로 읽는다 — 다시 걸어도 안 풀리는 쪽이다', () => {
  assert.equal(classifyFailure(REAL_TOO_LARGE), 'too_large')
})

test('크레딧 소진은 no_credit — 기다린다고 풀리지 않는다', () => {
  assert.equal(classifyFailure(REAL_NO_CREDIT), 'no_credit')
})

test('우리 예산 게이트가 막은 것도 rate_limit 한 뜻으로 묶는다', () => {
  assert.equal(classifyFailure(REAL_BUDGET_DENIED), 'rate_limit')
})

test('시간 초과와 모델 없음과 모르는 것이 갈라진다', () => {
  assert.equal(classifyFailure('The operation was aborted due to timeout'), 'timeout')
  assert.equal(classifyFailure('no usable model (0 tried)'), 'no_model')
  assert.equal(classifyFailure('무언가 잘못됐다'), 'unknown')
  assert.equal(classifyFailure(''), 'unknown')
})

test('접은 결과에 공급자 원문이 한 글자도 안 실린다', () => {
  const [one] = missingSections({ failures: [{ taskId: 'anomalies', error: REAL_TOO_LARGE }] })
  const serialized = JSON.stringify(one)
  assert.equal(one.reason, 'too_large')
  // 원문에 있던 것들 — 조직 id, 모델 이름, 과금 주소
  assert.ok(!serialized.includes('org_01EXAMPLE'), '조직 id 가 실렸다')
  assert.ok(!serialized.includes('qwen'), '모델 이름이 실렸다')
  assert.ok(!serialized.includes('console.groq.com'), '과금 주소가 실렸다')
})

test('실제 잡 기록 모양에서 셋을 뽑는다', () => {
  const progress = {
    nextJob: null,
    filledFields: 15,
    titleUpdated: true,
    reportVersion: 1,
    failures: [
      { taskId: 'budget', error: REAL_TOO_LARGE },
      { taskId: 'checklist', error: REAL_TOO_LARGE },
      { taskId: 'anomalies', error: REAL_TOO_LARGE },
    ],
  }
  assert.deepEqual(missingSections(progress).map((m) => m.taskId), ['budget', 'checklist', 'anomalies'])
})

test('같은 작업이 두 번 실패해도 한 줄로만 센다', () => {
  const out = missingSections({
    failures: [
      { taskId: 'anomalies', error: REAL_NO_CREDIT },
      { taskId: 'anomalies', error: REAL_TOO_LARGE },
    ],
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].reason, 'no_credit', '먼저 온 사유를 쓴다')
})

test('실패가 없거나 모양이 다르면 빈 배열 — 여기서 던지면 리포트 화면이 통째로 죽는다', () => {
  assert.deepEqual(missingSections(null), [])
  assert.deepEqual(missingSections({}), [])
  assert.deepEqual(missingSections({ failures: [] }), [])
  assert.deepEqual(missingSections({ failures: 'nope' }), [])
  assert.deepEqual(missingSections({ failures: [{ taskId: '' }] }), [])
})
