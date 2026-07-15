import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapWithConcurrency, probeModelIds } from './probe-models.ts'
import type { ChatProvider } from './provider.ts'

function fakeProvider(overrides: Partial<ChatProvider> = {}): ChatProvider {
  return {
    id: 'gemini',
    label: 'Gemini',
    capabilities: { vision: true, tools: true, thinking: false, defaultMaxOutputTokens: 8192 },
    streamChat: async () => ({ text: '', thinking: null, usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, stopped: false }),
    listModels: async () => [],
    ...overrides,
  }
}

test('mapWithConcurrency: 결과 순서가 입력 순서와 동일 (지연 역순이어도)', async () => {
  const items = [30, 10, 20]
  const out = await mapWithConcurrency(items, 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms))
    return ms
  })
  assert.deepEqual(out, [30, 10, 20])
})

test('mapWithConcurrency: 빈 배열', async () => {
  const out = await mapWithConcurrency<number, number>([], 4, async (n) => n)
  assert.deepEqual(out, [])
})

test('probeModelIds: probeModel 미구현 프로바이더는 전부 usable:true(스킵)', async () => {
  const provider = fakeProvider() // probeModel 없음
  const result = await probeModelIds(provider, 'key', ['a', 'b'])
  assert.equal(result.get('a'), true)
  assert.equal(result.get('b'), true)
})

test('probeModelIds: usable false 모델은 false로 표시', async () => {
  const provider = fakeProvider({
    probeModel: async (_key, model) => ({ usable: model !== 'dead-model' }),
  })
  const result = await probeModelIds(provider, 'key', ['live-model', 'dead-model'])
  assert.equal(result.get('live-model'), true)
  assert.equal(result.get('dead-model'), false)
})

test('probeModelIds: 개별 프로브가 예외를 던지면 관대하게 usable:true', async () => {
  const provider = fakeProvider({
    probeModel: async () => {
      throw new Error('network error')
    },
  })
  const result = await probeModelIds(provider, 'key', ['flaky-model'])
  assert.equal(result.get('flaky-model'), true)
})

test('probeModelIds: modelIds 빈 배열은 빈 map', async () => {
  const provider = fakeProvider({ probeModel: async () => ({ usable: true }) })
  const result = await probeModelIds(provider, 'key', [])
  assert.equal(result.size, 0)
})
