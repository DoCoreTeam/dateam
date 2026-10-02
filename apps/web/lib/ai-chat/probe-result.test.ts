// 가용 상태 판정 SSOT 가드 — 계정이 막힌 것과 모델이 한도에 걸린 것을 가른다
//
// ## 왜 생겼나 (실측 2026-10-01)
//
// OpenAI 모델 91개가 전부 「현재 요청 또는 토큰 한도에 도달했습니다. 잠시 후 다시 확인하세요」
// 였고, 실제 응답은 429 `insufficient_quota` / `credit_balance_exhausted`
// 「You have no credits remaining」이었다. 계정 크레딧이 0원이라 **기다려도 안 풀리는 것**을
// 기다리면 풀린다고 적은 것이다. 토큰 목록이 옛 문구(`exceeded your current quota`)만 알고
// 있었고, 이 파일에 가드가 **하나도 없었다**.
//
// 판정이 틀리면 두 가지가 동시에 망가진다
//  - 화면이 할 수 없는 일(기다리기)을 시키고 할 수 있는 일(결제)을 안 말한다
//  - accountLevel 조기 중단이 안 걸려 모델 수만큼 실호출을 때린다 (91개 × 키 수)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyModelProbeFailure, getProviderErrorDetail } from './probe-result.ts'

/** 실측 2026-10-01 OpenAI 응답 본문 그대로 */
const NO_CREDITS = 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'

test('크레딧 소진은 계정 단위 실패다 — 모델 한도가 아니다', () => {
  const r = classifyModelProbeFailure('OpenAI', 429, NO_CREDITS, 'credit_balance_exhausted')
  assert.equal(r.availability, 'unavailable', '기다려도 안 풀리므로 limited 가 아니다')
  assert.equal(r.accountLevel, true, 'accountLevel 이 없으면 남은 모델 전부에 실호출이 나간다')
  assert.equal(r.keyOutcome, 'quota')
  assert.match(r.reason ?? '', /결제/, '할 수 있는 일(결제)을 말해야 한다')
  assert.doesNotMatch(r.reason ?? '', /잠시 후/, '기다리라고 하면 안 된다')
})

test('code 가 없고 type 만 와도 같은 판정이다', () => {
  // 공급자가 code 를 바꿔도 type 은 남는다. 둘 중 하나만 봐도 걸려야 한다
  const r = classifyModelProbeFailure('OpenAI', 429, 'Something went wrong', 'insufficient_quota')
  assert.equal(r.availability, 'unavailable')
  assert.equal(r.accountLevel, true)
})

test('기계 코드가 아예 없어도 본문 문구로 걸린다', () => {
  // Gemini 프로브는 code 를 안 넘긴다 — 본문 텍스트만 온다
  const r = classifyModelProbeFailure('OpenAI', 429, NO_CREDITS)
  assert.equal(r.availability, 'unavailable')
  assert.equal(r.accountLevel, true)
})

test('옛 문구도 계속 걸린다', () => {
  const r = classifyModelProbeFailure('OpenAI', 429, 'You exceeded your current quota, please check your plan and billing details.')
  assert.equal(r.availability, 'unavailable')
  assert.equal(r.accountLevel, true)
})

test('평범한 한도 429 는 limited 로 남는다 — 기다리면 풀린다', () => {
  const r = classifyModelProbeFailure('OpenAI', 429, 'Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500, Used 500.')
  assert.equal(r.availability, 'limited')
  assert.notEqual(r.accountLevel, true, '한도는 그 모델·그 순간의 일이라 남은 모델을 포기하면 안 된다')
  assert.match(r.reason ?? '', /잠시 후/)
})

test('요금제가 그 모델을 안 주는 429 는 모델 단위 unavailable 이다', () => {
  const r = classifyModelProbeFailure('Gemini', 429, 'Quota exceeded: limit: 0 for metric generate_requests')
  assert.equal(r.availability, 'unavailable')
  assert.notEqual(r.accountLevel, true, '그 모델만 못 쓰는 것이라 다음 모델은 계속 확인해야 한다')
})

test('사유에 공급자 원문을 싣지 않는다 — 키 조각이 섞여 올 수 있다 (S3)', () => {
  const leaky = `Incorrect API key provided: sk-proj-ABCDEF. ${NO_CREDITS}`
  for (const r of [
    classifyModelProbeFailure('OpenAI', 429, leaky, 'credit_balance_exhausted'),
    classifyModelProbeFailure('OpenAI', 429, leaky),
    classifyModelProbeFailure('OpenAI', 404, leaky),
    classifyModelProbeFailure('OpenAI', 401, leaky),
    classifyModelProbeFailure('OpenAI', 500, leaky),
  ]) {
    assert.doesNotMatch(r.reason ?? '', /sk-proj/, '원문을 그대로 돌려주면 키 조각이 화면에 나간다')
    assert.doesNotMatch(r.reason ?? '', /Incorrect API key/)
  }
})

test('getProviderErrorDetail 은 code 와 type 을 둘 다 꺼낸다', () => {
  // OpenAI SDK 의 APIError 모양: error 안에 message·type·code 가 들어온다
  const sdkError = {
    status: 429,
    code: 'credit_balance_exhausted',
    type: 'insufficient_quota',
    error: { message: NO_CREDITS, type: 'insufficient_quota', code: 'credit_balance_exhausted' },
  }
  const got = getProviderErrorDetail(sdkError)
  assert.equal(got.status, 429)
  assert.equal(got.detail, NO_CREDITS)
  assert.equal(got.code, 'credit_balance_exhausted')
  assert.equal(got.type, 'insufficient_quota', 'type 을 안 꺼내면 code 가 바뀔 때 판정이 통째로 어긋난다')
})

/* ── 멈추는 판단과 말하는 판단은 다른 질문이다 ──────────────────
   젬민 무료 등급은 하루치 한도를 다 쓰면 「exceeded your current quota, please check your
   plan and billing details」라고 답하고 자정이면 풀린다. 돈이 떨어진 것이 아니다.
   그 문구로 「결제하세요」라고 말하면 반대쪽으로 거짓말하는 것이고, 그렇다고 그 키로
   남은 모델을 더 찔러 봐야 답은 같다 — 그래서 멈추기는 하고 말하지는 않는다. */

test('옛 문구는 훑기를 멈추게는 하되 결제라고 단정하지 않는다', async () => {
  const { isAccountQuotaFailure, isCreditExhaustedFailure } = await import('./probe-result.ts')
  const geminiFreeTier = 'you exceeded your current quota, please check your plan and billing details.'
  assert.equal(isAccountQuotaFailure(geminiFreeTier), true, '멈추지 않으면 남은 모델에 헛호출이 나간다')
  assert.equal(isCreditExhaustedFailure(geminiFreeTier), false, '자정이면 풀리는 것을 결제 문제로 적으면 안 된다')
})

test('돈이 떨어진 신호는 둘 다 참이다', async () => {
  const { isAccountQuotaFailure, isCreditExhaustedFailure } = await import('./probe-result.ts')
  for (const [raw, code, type] of [
    ['you have no credits remaining.', undefined, undefined],
    ['something', 'credit_balance_exhausted', undefined],
    ['something', undefined, 'insufficient_quota'],
  ] as Array<[string, string | undefined, string | undefined]>) {
    assert.equal(isCreditExhaustedFailure(raw, code, type), true, `${raw}/${code}/${type}`)
    assert.equal(isAccountQuotaFailure(raw, code, type), true, `${raw}/${code}/${type}`)
  }
})
