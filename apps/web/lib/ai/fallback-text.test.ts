// lib/ai/fallback-text.test.ts — 두 번째 공급자의 응답 해석 경계
//
// 왜 이 가드가 있나: OpenAI 호환 응답의 모양이 바뀌면 본문이 조용히 빈 문자열이 되고,
// 호출부는 그것을 "AI가 답을 안 줬다"로 읽는다. 원인이 파싱인데 공급자를 의심하게 된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractChoiceText, extractUsage, FALLBACK_MODELS, callFallbackJson, reduceFallbackReason,
} from './fallback-text.ts'

test('정상 응답에서 본문을 꺼낸다', () => {
  const json = { choices: [{ message: { content: '{"found":true}' } }] }
  assert.equal(extractChoiceText(json), '{"found":true}')
})

test('모양이 다르면 빈 문자열 — 지어내지 않는다', () => {
  assert.equal(extractChoiceText(null), '')
  assert.equal(extractChoiceText({}), '')
  assert.equal(extractChoiceText({ choices: [] }), '')
  assert.equal(extractChoiceText({ choices: [{ message: {} }] }), '')
  assert.equal(extractChoiceText({ choices: [{ message: { content: 42 } }] }), '')
})

test('usage 가 없으면 0 — 토큰 수를 추정하지 않는다', () => {
  assert.deepEqual(extractUsage(null), { prompt: 0, output: 0, total: 0 })
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }),
    { prompt: 10, output: 3, total: 13 },
  )
})

test('키가 없으면 네트워크를 건드리지 않고 실패로 돌려준다', async () => {
  const out = await callFallbackJson({ prompt: 'x', apiKey: '' })
  assert.equal(out.ok, false)
  assert.ok(!out.ok && out.attempts.length > 0, '왜 못 했는지를 남긴다')
})

test('모델 사슬은 비어 있지 않다', () => {
  assert.ok(FALLBACK_MODELS.length >= 2, '하나가 막히면 갈 곳이 있어야 한다')
})

/*
  실패 이유를 **값으로** 돌려준다 (P0030 I02)

  예전에는 사유가 attempts 문자열에만 있어서 부르는 쪽이 「429 가 들어 있나」를
  정규식으로 뒤져야 했다. 그래서 아무도 안 뒤졌고, 한도로 막힌 호출이
  「서버 응답 없음」으로 올라가 멈춤 장치가 안 걸렸다 (실측 2026-09-20: 23,096건).
*/
test('한도가 하나라도 있으면 한도다', () => {
  assert.equal(reduceFallbackReason([429]), 'quota')
  assert.equal(reduceFallbackReason([500, 429, 503]), 'quota')
})

test('인증 실패는 한도보다 먼저다 — 기다려도 안 풀리기 때문', () => {
  assert.equal(reduceFallbackReason([429, 401]), 'auth')
  assert.equal(reduceFallbackReason([403]), 'auth')
})

test('상태가 없으면 서버 문제로 둔다 — 한도라고 지어내지 않는다', () => {
  assert.equal(reduceFallbackReason([]), 'server')
  assert.equal(reduceFallbackReason([500, 503]), 'server')
})

test('키가 없으면 no_key 다 — 나간 것이 없는 것과 막힌 것은 다르다', async () => {
  const r = await callFallbackJson({ prompt: 'p', apiKey: '' })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'no_key')
})
