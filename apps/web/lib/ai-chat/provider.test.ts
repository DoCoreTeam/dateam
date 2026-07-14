import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatTurn } from './provider.ts'
import { toGeminiContents } from './providers/gemini.ts'
import { toClaudeMessages } from './providers/claude.ts'
import { toOpenAiMessages } from './providers/openai.ts'

const TURNS: ChatTurn[] = [
  { role: 'user', content: '안녕' },
  { role: 'assistant', content: '반가워요' },
  { role: 'user', content: '오늘 날씨는?' },
]

test('toGeminiContents: assistant→model 매핑 + parts 구조', () => {
  const out = toGeminiContents(TURNS)
  assert.deepEqual(out, [
    { role: 'user', parts: [{ text: '안녕' }] },
    { role: 'model', parts: [{ text: '반가워요' }] },
    { role: 'user', parts: [{ text: '오늘 날씨는?' }] },
  ])
})

test('toGeminiContents: 빈 배열', () => {
  assert.deepEqual(toGeminiContents([]), [])
})

test('toClaudeMessages: role 보존', () => {
  assert.deepEqual(toClaudeMessages(TURNS), [
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: '반가워요' },
    { role: 'user', content: '오늘 날씨는?' },
  ])
})

test('toClaudeMessages: 단일 턴', () => {
  assert.deepEqual(toClaudeMessages([{ role: 'user', content: 'hi' }]), [
    { role: 'user', content: 'hi' },
  ])
})

test('toOpenAiMessages: system 있으면 첫 원소', () => {
  const out = toOpenAiMessages('너는 도우미다', TURNS)
  assert.equal(out[0].role, 'system')
  assert.equal(out[0].content, '너는 도우미다')
  assert.equal(out.length, TURNS.length + 1)
})

test('toOpenAiMessages: system 없으면 미포함', () => {
  const out = toOpenAiMessages(undefined, TURNS)
  assert.equal(out.length, TURNS.length)
  assert.equal(out[0].role, 'user')
})

test('toOpenAiMessages: 빈 턴 + system 없음 → 빈 배열', () => {
  assert.deepEqual(toOpenAiMessages(undefined, []), [])
})
