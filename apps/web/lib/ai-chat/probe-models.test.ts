import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapWithConcurrency, probeModelIds } from './probe-models.ts'
import type { ChatProvider } from './provider.ts'
import { classifyModelProbeFailure, getProviderErrorDetail } from './probe-result.ts'
import { claudeProvider } from './providers/claude.ts'
import { geminiProvider } from './providers/gemini.ts'
import { openaiProvider } from './providers/openai.ts'
import { isSelectableModelAvailability } from './model-availability.ts'

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
  assert.equal(result.get('a')?.usable, true)
  assert.equal(result.get('b')?.usable, true)
})

test('probeModelIds: usable false 모델은 false로 표시', async () => {
  const provider = fakeProvider({
    probeModel: async (_key, model) => ({ usable: model !== 'dead-model' }),
  })
  const result = await probeModelIds(provider, 'key', ['live-model', 'dead-model'])
  assert.equal(result.get('live-model')?.usable, true)
  assert.equal(result.get('dead-model')?.usable, false)
})

test('probeModelIds: 개별 프로브가 예외를 던지면 관대하게 usable:true', async () => {
  const provider = fakeProvider({
    probeModel: async () => {
      throw new Error('network error')
    },
  })
  const result = await probeModelIds(provider, 'key', ['flaky-model'])
  assert.equal(result.get('flaky-model')?.usable, true)
})

test('probeModelIds: modelIds 빈 배열은 빈 map', async () => {
  const provider = fakeProvider({ probeModel: async () => ({ usable: true }) })
  const result = await probeModelIds(provider, 'key', [])
  assert.equal(result.size, 0)
})

test('실호출 판정: 모델 미지원·할당량 0·일시 한도를 구분', () => {
  assert.equal(classifyModelProbeFailure('OpenAI', 404, 'not found').availability, 'unavailable')
  assert.equal(classifyModelProbeFailure('Claude', 400, 'model is not supported').availability, 'unavailable')
  assert.equal(classifyModelProbeFailure('Gemini', 429, 'quota limit is 0').availability, 'unavailable')
  assert.equal(classifyModelProbeFailure('Gemini', 429, 'rate limit').availability, 'limited')
})

test('실호출 판정: 인증·서버 오류는 모델을 잘못 차단하지 않음', () => {
  assert.equal(classifyModelProbeFailure('OpenAI', 401, 'bad key').usable, true)
  assert.equal(classifyModelProbeFailure('OpenAI', 500, 'server error').availability, 'unknown')
  assert.deepEqual(getProviderErrorDetail({ status: 404, error: { message: 'model not found' } }), {
    status: 404,
    detail: 'model not found',
  })
})

test('모델 가용 점검을 모든 공급자가 모두 제공', () => {
  assert.equal(typeof geminiProvider.probeModel, 'function')
  assert.equal(typeof claudeProvider.probeModel, 'function')
  assert.equal(typeof openaiProvider.probeModel, 'function')
})

test('모델 선택 후보는 available·unknown만 허용', () => {
  assert.equal(isSelectableModelAvailability('available'), true)
  assert.equal(isSelectableModelAvailability('unknown'), true)
  assert.equal(isSelectableModelAvailability('limited'), false)
  assert.equal(isSelectableModelAvailability('unavailable'), false)
})
