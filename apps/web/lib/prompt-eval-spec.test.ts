import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalPromptCandidate, evalSpecForKey, REQUIRED_PROMPT_TOKENS } from './gpu/prompt-governance.ts'

test('evalSpecForKey: gpu.* → GPU 토큰', () => {
  assert.deepEqual(evalSpecForKey('gpu.quote-extract'), REQUIRED_PROMPT_TOKENS)
})

test('evalSpecForKey: daily.* → title/status/confidence', () => {
  assert.deepEqual(evalSpecForKey('daily.analyze-work'), ['title', 'status', 'confidence'])
})

test('evalSpecForKey: 미등록 키 → 빈 spec', () => {
  assert.deepEqual(evalSpecForKey('weekly.merge-by-category'), [])
})

test('evalPromptCandidate: 기본 spec=GPU(후방호환)', () => {
  const ok = evalPromptCandidate('model_name unit_price_usd supplier quantity resp_qty term 포함')
  assert.equal(ok.ok, true)
  const bad = evalPromptCandidate('model_name 만 있음')
  assert.equal(bad.ok, false)
  assert.ok(bad.missing.includes('supplier'))
})

test('evalPromptCandidate: daily spec 적용', () => {
  const spec = evalSpecForKey('daily.analyze-work')
  assert.equal(evalPromptCandidate('title status confidence 다 포함', spec).ok, true)
  assert.equal(evalPromptCandidate('title 만', spec).ok, false)
})
