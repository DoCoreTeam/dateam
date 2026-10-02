import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProviderError } from './provider-errors.ts'

test('classifyProviderError: "limit: 0" → fatalModel true + 요금제 안내', () => {
  const { message, fatalModel } = classifyProviderError(new Error('429 Too Many Requests: quota limit: 0'))
  assert.equal(fatalModel, true)
  assert.match(message, /요금제/)
})

test('classifyProviderError: quota 초과(0 아님) → fatalModel false + 한도 안내', () => {
  const { message, fatalModel } = classifyProviderError(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'))
  assert.equal(fatalModel, false)
  assert.match(message, /한도/)
})

test('classifyProviderError: 순수 429(quota/limit 문구 없음) → fatalModel false', () => {
  const { fatalModel } = classifyProviderError(new Error('429 rate limited, retry later'))
  assert.equal(fatalModel, false)
})

test('classifyProviderError: 404 → fatalModel true + 모델 불가 안내', () => {
  const { message, fatalModel } = classifyProviderError(new Error('404 model not found'))
  assert.equal(fatalModel, true)
  assert.match(message, /더 이상 사용할 수 없습니다/)
})

test('classifyProviderError: "no longer available" → fatalModel true', () => {
  const { fatalModel } = classifyProviderError(new Error('Model gemini-pro is no longer available'))
  assert.equal(fatalModel, true)
})

test('classifyProviderError: "is not supported" → fatalModel true', () => {
  const { fatalModel } = classifyProviderError(new Error('This model is not supported for generateContent'))
  assert.equal(fatalModel, true)
})

test('classifyProviderError: 401 → fatalModel false + 키 인증 안내', () => {
  const { message, fatalModel } = classifyProviderError(new Error('401 Unauthorized'))
  assert.equal(fatalModel, false)
  assert.match(message, /키 인증/)
})

test('classifyProviderError: 403 permission → fatalModel false', () => {
  const { fatalModel } = classifyProviderError(new Error('403 Forbidden: permission denied'))
  assert.equal(fatalModel, false)
})

test('classifyProviderError: 알 수 없는 오류 → 일반 안내, fatalModel false', () => {
  const { message, fatalModel } = classifyProviderError(new Error('unexpected network hiccup'))
  assert.equal(fatalModel, false)
  assert.match(message, /AI 응답을 생성하지 못했습니다/)
})

test('classifyProviderError: Error 아닌 값(string)도 처리', () => {
  const { fatalModel } = classifyProviderError('404 not found')
  assert.equal(fatalModel, true)
})

test('classifyProviderError: null/undefined도 예외 없이 일반 안내 반환', () => {
  const { message, fatalModel } = classifyProviderError(undefined)
  assert.equal(fatalModel, false)
  assert.match(message, /AI 응답을 생성하지 못했습니다/)
})

/* ── 무엇이 죽었는가: scope 와 keyOutcome ──────────────────────────────
   이 둘이 틀리면 증상이 조용하다. 429 를 모델 탓으로 읽으면 멀쩡한 모델이 카탈로그에서
   내려가고, 키 탓으로 못 읽으면 다음 키를 두고도 공급자를 통째로 버린다. */

test('429 는 키의 문제다 — 그 키로는 어느 모델을 불러도 막혀 있다', () => {
  const c = classifyProviderError(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'))
  assert.equal(c.scope, 'key')
  assert.equal(c.keyOutcome, 'quota')
})

test('limit: 0 은 모델의 문제다 — 키를 갈아도 이 모델은 안 준다', () => {
  const c = classifyProviderError(new Error('429 quota limit: 0'))
  assert.equal(c.scope, 'model')
  assert.equal(c.keyOutcome, undefined, '요금제가 안 주는 것을 키 탓으로 적으면 멀쩡한 키가 쉰다')
})

test('401 403 은 키의 문제이고 기다려서 풀릴 일이 아니다', () => {
  assert.equal(classifyProviderError(new Error('401 Unauthorized')).scope, 'key')
  assert.equal(classifyProviderError(new Error('401 Unauthorized')).keyOutcome, 'auth')
  assert.equal(classifyProviderError(new Error('403 Forbidden: permission denied')).keyOutcome, 'auth')
})

test('404 는 키를 벌주지 않는다 — 모델이 없어진 것이지 키가 죽은 것이 아니다', () => {
  const c = classifyProviderError(new Error('404 model not found'))
  assert.equal(c.scope, 'model')
  assert.equal(c.keyOutcome, undefined)
})

test('원인 불명은 transient 이고 키 처리를 지시하지 않는다', () => {
  const c = classifyProviderError(new Error('unexpected network hiccup'))
  assert.equal(c.scope, 'transient')
  assert.equal(c.keyOutcome, undefined)
})

/* ── 요청이 너무 큰 것과 한도는 다른 말이다 (실측 2026-09-23) ── */

test('★ request too large 는 그 모델만 건너뛴다 — 키를 벌주지 않는다', () => {
  // groq 원문. 107KB 짜리 견적서 PDF 를 올렸을 때 실제로 온 값이다
  const c = classifyProviderError(new Error(
    '429 Request too large for model `qwen/qwen3.8-27b` in organization `org_x` '
    + 'service tier `on_demand` on tokens per minute (TPM): Limit 15000, Requested 41231',
  ))
  assert.equal(c.scope, 'model', '키를 바꿔도 같은 요청은 안 들어간다')
  assert.equal(c.keyOutcome, undefined,
    '한도로 적으면 그 키가 10분 쉬고 같은 키를 쓰는 다른 기능까지 같이 막힌다')
  assert.equal(c.availability, undefined,
    '모델이 죽은 게 아니라 이번 첨부가 컸던 것이다. 적어 두면 작은 요청까지 그 모델을 못 쓴다')
  assert.equal(c.fatalModel, false)
})

test('★ 그냥 429 는 여전히 키의 한도다 — 위 분기가 정상 한도를 삼키지 않는다', () => {
  const c = classifyProviderError(new Error('429 You exceeded your current quota'))
  assert.equal(c.scope, 'key')
  assert.equal(c.keyOutcome, 'quota')
})

/* ── 계정 크레딧 소진 ─────────────────────────────────────────────
   429 를 전부 「잠시 후 다시 시도」로 읽으면 결제 문제가 영원히 안 풀리는 기다림이 된다.
   실측 2026-10-01: OpenAI 가 「You have no credits remaining」을 429 로 돌려줬고
   화면은 기다리라고만 했다. 판정 문구는 probe-result 와 **같은 목록**을 본다 — 한쪽만
   고치면 모델 선택 창과 채팅이 같은 상황에 다른 말을 한다. */

const NO_CREDITS_ERROR = new Error('429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.')

test('classifyProviderError: 크레딧 소진 → 결제를 가리킨다', () => {
  const { message } = classifyProviderError(NO_CREDITS_ERROR)
  assert.match(message, /결제/)
  assert.doesNotMatch(message, /잠시 후/, '기다려도 안 풀린다')
})

test('classifyProviderError: 크레딧 소진도 키 범위다 — 다음 키로 이어 간다', () => {
  const { scope, keyOutcome, fatalModel } = classifyProviderError(NO_CREDITS_ERROR)
  assert.equal(scope, 'key', '그 키의 사정이지 모델의 사정이 아니다')
  assert.equal(keyOutcome, 'quota')
  assert.equal(fatalModel, false, '모델을 카탈로그에서 내리면 안 된다 — 다른 키로는 멀쩡하다')
})

test('classifyProviderError: 크레딧 소진은 기계 코드 없이 문구만으로도 걸린다', () => {
  // SDK 를 안 거치는 자리(원문 문자열만 올라오는 길)도 같은 답을 내야 한다
  const { message } = classifyProviderError(new Error('429 insufficient_quota: add credits to continue'))
  assert.match(message, /결제/)
})

test('classifyProviderError: 평범한 한도 429 는 기존 문장 그대로', () => {
  const { message, scope, keyOutcome } = classifyProviderError(new Error('429 Rate limit reached for gpt-4o on requests per min (RPM)'))
  assert.match(message, /잠시 후 다시 시도/)
  assert.doesNotMatch(message, /결제/)
  assert.equal(scope, 'key')
  assert.equal(keyOutcome, 'quota')
})

test('classifyProviderError: 젬민 무료 등급의 하루 한도는 결제가 아니라 한도다', () => {
  // 자정이면 풀린다. 결제로 말하면 사용자가 안 써도 될 돈을 쓴다
  const { message, keyOutcome } = classifyProviderError(new Error(
    'Gemini API 오류 (429): You exceeded your current quota, please check your plan and billing details.'))
  assert.match(message, /한도/)
  assert.doesNotMatch(message, /결제/)
  assert.equal(keyOutcome, 'quota')
})
