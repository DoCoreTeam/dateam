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
