import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supportsAdaptiveThinking, thinkingFor } from './claude-thinking.ts'

test('운영에 설정된 haiku 4.5 (날짜 꼬리 포함) 에는 생각을 안 싣는다', () => {
  assert.equal(supportsAdaptiveThinking('claude-haiku-4-5-20251001'), false)
  assert.equal(supportsAdaptiveThinking('claude-haiku-4-5'), false)
  assert.deepEqual(thinkingFor('claude-haiku-4-5-20251001'), {})
})

test('4.6 이전 모델과 옛 이름표는 adaptive 를 못 받는다', () => {
  for (const m of ['claude-sonnet-4-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-20250514',
    'claude-opus-4-1', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4']) {
    assert.equal(supportsAdaptiveThinking(m), false, m)
  }
})

test('4.6 이상 5.x fable mythos 는 adaptive 를 받는다', () => {
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-5',
    'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
    assert.equal(supportsAdaptiveThinking(m), true, m)
  }
  assert.deepEqual(thinkingFor('claude-opus-4-8'), { thinking: { type: 'adaptive', display: 'summarized' } })
})

test('어댑터가 생각 설정을 이 함수로만 싣는다 (고정값 재등장 금지)', () => {
  const src = readFileSync(new URL('./claude.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('...thinkingFor('), 'claude.ts 가 thinkingFor 를 펼쳐 넣어야 한다')
  assert.equal(/thinking:\s*\{\s*type:\s*'adaptive'/.test(src), false, '고정 adaptive 가 다시 생겼다')
})
