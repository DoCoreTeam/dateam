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
    code: undefined,
  })
})

test('실호출 판정: 크레딧 소진(insufficient_quota)은 "일시 한도"가 아니라 결제 문제로 구분', () => {
  // OpenAI는 크레딧이 없어도 HTTP 429를 준다. 문구에 limit:0/quota:0이 없어 기존 규칙으로는
  // "잠시 후 다시"로 오분류됐고, 그래서 전 모델이 limited로 잠겨 목록이 통째로 비었다.
  const byMessage = classifyModelProbeFailure(
    'OpenAI',
    429,
    'You exceeded your current quota, please check your plan and billing details.',
  )
  assert.equal(byMessage.availability, 'unavailable')
  assert.equal(byMessage.accountLevel, true)
  assert.match(byMessage.reason ?? '', /결제/)

  // 문구가 바뀌어도 기계판독 코드로 잡는다.
  const byCode = classifyModelProbeFailure('OpenAI', 429, 'whatever', 'insufficient_quota')
  assert.equal(byCode.availability, 'unavailable')
  assert.equal(byCode.accountLevel, true)

  // 진짜 일시적 한도는 여전히 limited(재시도 가능)로 남아야 한다 — 과교정 금지.
  const transient = classifyModelProbeFailure('OpenAI', 429, 'rate limit reached for gpt-4o')
  assert.equal(transient.availability, 'limited')
  assert.equal(transient.accountLevel, undefined)
})

test('실호출 판정: 401(키 무효)만 계정 단위 — 403은 모델별 접근 등급일 수 있어 조기중단 금지', () => {
  assert.equal(classifyModelProbeFailure('OpenAI', 401, 'bad key').accountLevel, true)

  // OpenAI·Anthropic 모두 "조직 인증이 필요한 개별 모델"에 403을 준다. 이걸 계정 실패로 보면
  // 등급 제한 모델 하나가 나머지 전 모델의 확인을 막아버린다(키는 멀쩡한데).
  const forbidden = classifyModelProbeFailure('OpenAI', 403, 'forbidden')
  assert.equal(forbidden.accountLevel, undefined)
  assert.equal(forbidden.availability, 'unknown')
  assert.equal(forbidden.usable, true)
})

test('probeModelIds: 403은 조기 중단시키지 않는다 — 나머지 모델을 전부 확인한다', async () => {
  let calls = 0
  const provider = fakeProvider({
    probeModel: async (_key: string, model: string) =>
      model === 'gated'
        ? classifyModelProbeFailure('OpenAI', 403, 'must be verified to use this model')
        : { usable: true, availability: 'available' as const, reason: null },
  })
  const ids = ['gated', 'a', 'b', 'c']
  const wrapped = { ...provider, probeModel: async (k: string, m: string) => { calls += 1; return provider.probeModel!(k, m) } }
  const result = await probeModelIds(wrapped, 'key', ids, 1)

  assert.equal(calls, 4)
  assert.equal(result.get('a')?.availability, 'available')
})

test('probeModelIds: 계정 단위 실패를 만나면 남은 모델은 호출 없이 같은 결과로 채운다', async () => {
  let calls = 0
  const provider = fakeProvider({
    probeModel: async () => {
      calls += 1
      return classifyModelProbeFailure('OpenAI', 429, 'You exceeded your current quota')
    },
  })
  const ids = Array.from({ length: 20 }, (_, i) => `m${i}`)
  // 동시성 1이면 첫 실패 직후 전부 차단 — 86개 모델에 실 API를 86번 때리던 폭주를 막는 핵심.
  const result = await probeModelIds(provider, 'key', ids, 1)

  assert.equal(calls, 1)
  assert.equal(result.size, ids.length)
  for (const id of ids) {
    assert.equal(result.get(id)?.availability, 'unavailable')
    assert.equal(result.get(id)?.accountLevel, true)
  }
})

test('probeModelIds: 조기 중단은 O(1)이 아니라 O(동시성) — 이미 뜬 요청은 취소하지 않는다', async () => {
  let calls = 0
  const provider = fakeProvider({
    probeModel: async () => {
      calls += 1
      return classifyModelProbeFailure('OpenAI', 429, 'You exceeded your current quota')
    },
  })
  const ids = Array.from({ length: 50 }, (_, i) => `m${i}`)
  await probeModelIds(provider, 'key', ids, 4)

  // 취소가 아니라 "다음 차례부터 차단"이므로 최대 동시성만큼은 실제로 나간다. 50번이 아니라 4번 이하.
  assert.ok(calls <= 4, `계정 실패 후에도 ${calls}번 호출됨(동시성 4 상한 초과)`)
})

test('probeModelIds: 모델 단위 실패는 조기 중단하지 않고 전부 확인한다', async () => {
  let calls = 0
  const provider = fakeProvider({
    probeModel: async () => {
      calls += 1
      return classifyModelProbeFailure('OpenAI', 404, 'model not found')
    },
  })
  const ids = ['a', 'b', 'c']
  await probeModelIds(provider, 'key', ids, 1)
  assert.equal(calls, 3)
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
