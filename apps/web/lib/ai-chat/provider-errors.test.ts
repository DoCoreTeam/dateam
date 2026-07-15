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
