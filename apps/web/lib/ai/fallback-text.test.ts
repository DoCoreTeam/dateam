// lib/ai/fallback-text.test.ts — 두 번째 공급자의 응답 해석 경계
//
// 왜 이 가드가 있나: OpenAI 호환 응답의 모양이 바뀌면 본문이 조용히 빈 문자열이 되고,
// 호출부는 그것을 "AI가 답을 안 줬다"로 읽는다. 원인이 파싱인데 공급자를 의심하게 된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractChoiceText, extractUsage, FALLBACK_MODELS, callFallbackJson } from './fallback-text.ts'

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
