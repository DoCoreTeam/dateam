import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAvailableProviders,
  getProviderConfig,
  getDefaultProvider,
  getProviderOrder,
  isWired,
  META_KEYS,
  DEFAULT_MODELS,
} from './registry.ts'
import { AI_PROVIDERS, AI_PROVIDER_IDS } from '../ai/provider-catalog.ts'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini-model.ts'

test('available: 키 3개 모두 있으면 3개', () => {
  const meta = {
    gemini_api_key: 'g',
    claude_api_key: 'c',
    openai_api_key: 'o',
    openai_model: 'gpt-4o',
  }
  const list = getAvailableProviders(meta)
  assert.deepEqual(
    list.map((c) => c.id),
    ['gemini', 'claude', 'openai'],
  )
})

// v0.7.571: 폴백 모델을 SSOT(lib/ai/gemini-model.ts)로 옮겼다. 죽은 'gemini-2.0-flash'를
// 여기 문자열로 다시 박으면, SSOT를 고쳐도 이 가드만 옛 모델을 붙들어 드리프트가 생긴다.
test('available: gemini 키만 → 1개 + 모델은 SSOT 기본값으로 폴백', () => {
  const list = getAvailableProviders({ gemini_api_key: 'g' })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'gemini')
  assert.equal(list[0].model, DEFAULT_GEMINI_MODEL)
})

test('available: claude 키만·모델 미설정 → 모델 claude-opus-4-8 폴백', () => {
  const list = getAvailableProviders({ claude_api_key: 'c' })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'claude')
  assert.equal(list[0].model, 'claude-opus-4-8')
})

test('available: openai 키 있음 + 모델 미설정 → 제외', () => {
  const list = getAvailableProviders({ openai_api_key: 'o' })
  assert.equal(list.length, 0)
})

test('available: openai 키 + 모델 설정 → 포함', () => {
  const list = getAvailableProviders({ openai_api_key: 'o', openai_model: 'gpt-4o' })
  assert.equal(list.length, 1)
  assert.equal(list[0].model, 'gpt-4o')
})

test('available: 빈 META → 빈 배열', () => {
  assert.deepEqual(getAvailableProviders({}), [])
})

test('getProviderConfig: 미가용 프로바이더 → null', () => {
  assert.equal(getProviderConfig({}, 'claude'), null)
  assert.equal(getProviderConfig({ openai_api_key: 'o' }, 'openai'), null) // 모델 없음
  const cfg = getProviderConfig({ claude_api_key: 'c', claude_model: 'claude-opus-4-8' }, 'claude')
  assert.equal(cfg?.model, 'claude-opus-4-8')
})

test('getDefaultProvider: 설정값이 가용이면 해당 설정', () => {
  const meta = {
    gemini_api_key: 'g',
    claude_api_key: 'c',
    ai_chat_default_provider: 'claude',
  }
  assert.equal(getDefaultProvider(meta)?.id, 'claude')
})

test('getDefaultProvider: 설정값 미가용 → 첫 available', () => {
  const meta = { gemini_api_key: 'g', ai_chat_default_provider: 'openai' }
  assert.equal(getDefaultProvider(meta)?.id, 'gemini')
})

test('getDefaultProvider: 미설정 → 첫 available (고정 순서 gemini)', () => {
  const meta = { gemini_api_key: 'g', claude_api_key: 'c' }
  assert.equal(getDefaultProvider(meta)?.id, 'gemini')
})

test('getDefaultProvider: 빈 META → null', () => {
  assert.equal(getDefaultProvider({}), null)
})

/* ── v0.9.0 I02: 목록이 명세에서 파생되는가 ────────────────── */

test('파생: META_KEYS·DEFAULT_MODELS·순서가 전부 명세와 같은 크기', () => {
  assert.equal(Object.keys(META_KEYS).length, AI_PROVIDERS.length)
  assert.equal(Object.keys(DEFAULT_MODELS).length, AI_PROVIDERS.length)
  assert.deepEqual(getProviderOrder({}), AI_PROVIDER_IDS)
})

test('파생: META_KEYS 가 명세의 키 이름을 그대로 쓴다', () => {
  for (const spec of AI_PROVIDERS) {
    assert.deepEqual(META_KEYS[spec.id], spec.meta, `${spec.id}`)
  }
})

// gemini 기본 모델만은 lib/ai/gemini-model 이 원본이다 — 그 파일이 JSON 모드 지원까지 함께
// 관리하므로 값을 두 곳에 적으면 갈린다.
test('파생: gemini 기본 모델은 gemini-model SSOT 를 따른다', () => {
  assert.equal(DEFAULT_MODELS.gemini, DEFAULT_GEMINI_MODEL)
})

/* ── 이미 저장된 Groq 키를 잃지 않는가 ─────────────────────── */

// 조직에 이미 들어 있는 키는 「음성 인식」 카드에서 넣은 stt_api_key 다.
// 이 단정이 깨지면 그날로 Groq 이 후보에서 사라진다.
test('groq: stt_api_key 만 있어도 후보에 들어온다', () => {
  const list = getAvailableProviders({ stt_api_key: 'gsk_live' })
  assert.deepEqual(list.map((c) => c.id), ['groq'])
  assert.equal(list[0].model, 'llama-3.3-70b-versatile')
})

test('grok: xai_api_key 로 후보에 들어온다', () => {
  const list = getAvailableProviders({ xai_api_key: 'xai-live' })
  assert.deepEqual(list.map((c) => c.id), ['grok'])
})

test('키가 없는 공급자는 후보에서 빠진다', () => {
  assert.deepEqual(getAvailableProviders({}), [])
})

test('다섯 키가 다 있으면 명세 순서대로 다섯', () => {
  const list = getAvailableProviders({
    gemini_api_key: 'g', claude_api_key: 'c',
    openai_api_key: 'o', openai_model: 'gpt-4o',
    stt_api_key: 'gsk_x', xai_api_key: 'xai-x',
  })
  assert.deepEqual(list.map((c) => c.id), ['gemini', 'claude', 'openai', 'groq', 'grok'])
})

/* ── 반쯤 등록된 공급자가 사용자에게 닿지 않는가 ───────────── */

test('배선 게이트: 명세의 다섯이 전부 배선돼 있다', () => {
  for (const id of AI_PROVIDER_IDS) assert.equal(isWired(id), true, `${id} 미배선`)
})

// 명세만 넓히고 어댑터를 미루면, 저장된 키가 후보에 들어와 첫 호출에서 터진다.
// 그래서 후보 판정이 배선 여부를 먼저 본다.
test('배선 게이트: 배선 안 된 id 는 키가 있어도 후보가 아니다', () => {
  assert.equal(isWired('mistral' as never), false)
  assert.equal(getProviderConfig({ mistral_api_key: 'x' }, 'mistral' as never), null)
})

/* ── 폴백 순서 ─────────────────────────────────────────────── */

test('순서: 저장값이 이기고, 빠진 공급자는 명세 순서대로 뒤에 붙는다', () => {
  const order = getProviderOrder({ ai_chat_provider_order: ['groq', 'claude'] })
  assert.deepEqual(order.slice(0, 2), ['groq', 'claude'])
  assert.equal(order.length, AI_PROVIDER_IDS.length)
  assert.deepEqual([...order].sort(), [...AI_PROVIDER_IDS].sort())
})

test('순서: 모르는 이름이 저장돼 있으면 무시한다', () => {
  const order = getProviderOrder({ ai_chat_provider_order: ['mistral', 'grok'] })
  assert.equal(order[0], 'grok')
  assert.equal(order.length, AI_PROVIDER_IDS.length)
})

test('순서: 저장된 순서대로 후보가 나온다', () => {
  const list = getAvailableProviders({
    gemini_api_key: 'g', stt_api_key: 'gsk_x',
    ai_chat_provider_order: ['groq', 'gemini'],
  })
  assert.deepEqual(list.map((c) => c.id), ['groq', 'gemini'])
})
