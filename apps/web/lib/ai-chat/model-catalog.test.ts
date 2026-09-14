import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mergeModelCatalogEntry, inferModelMeta, isChatModel, inferModelUseCase, CURATED_MODELS } from './model-catalog.ts'
import { AI_PROVIDERS, AI_PROVIDER_IDS, getProviderSpec } from '../ai/provider-catalog.ts'

test('용도안내: 티어별 친절 설명', () => {
  assert.match(inferModelUseCase('gemini', 'gemini-2.5-pro', { vision: true, longContext: true, reasoning: true }), /추론|분석|코딩/)
  assert.match(inferModelUseCase('gemini', 'gemini-2.0-flash-lite', { vision: true, longContext: true, reasoning: false }), /빠르고 저렴|간단/)
  assert.match(inferModelUseCase('gemini', 'gemini-2.0-flash', { vision: true, longContext: true, reasoning: false }), /빠른 범용|대화/)
})

test('필터: 이미지 생성 모델(-image·banana)은 채팅목록 제외', () => {
  assert.equal(isChatModel('gemini', 'gemini-3-pro-image'), false)
  assert.equal(isChatModel('gemini', 'gemini-3.1-flash-image-preview'), false)
  assert.equal(isChatModel('gemini', 'nano-banana-pro-preview'), false)
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash'), true)
})

test('추론: 큐레이션에 없는 라이브 Gemini 모델도 능력(멀티모달)·출시일이 채워진다', () => {
  const m = inferModelMeta('gemini', 'gemini-2.5-flash')
  assert.equal(m.capabilities.vision, true)      // 멀티모달 여부 표시됨
  assert.equal(m.capabilities.longContext, true)
  assert.equal(m.releasedAt, '2025-03-25')
  assert.equal(m.label, 'Gemini 2.5 Flash')
  // pro는 추론형
  assert.equal(inferModelMeta('gemini', 'gemini-2.5-pro').capabilities.reasoning, true)
})

test('추론: merge가 큐레이션 없는 모델에 추론값을 채워 빈칸 방지', () => {
  const e = mergeModelCatalogEntry('gemini', 'gemini-2.0-flash-001', null)
  assert.equal(e.capabilities.vision, true)
  assert.equal(e.releasedAt, '2025-02-05')
  assert.notEqual(e.label, 'gemini-2.0-flash-001') // prettify됨
})

test('isChatModel: tts·embedding·imagen 제외, 일반 채팅모델 통과', () => {
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash-preview-tts'), false)
  assert.equal(isChatModel('gemini', 'text-embedding-004'), false)
  assert.equal(isChatModel('gemini', 'imagen-3.0'), false)
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash'), true)
})

test('추론: 큐레이션이 있으면 큐레이션이 우선(정확값)', () => {
  const e = mergeModelCatalogEntry('gemini', 'gemini-2.0-flash', null)
  assert.equal(e.label, 'Gemini 2.0 Flash')
  assert.equal(e.releasedAt, '2025-02-05')  // 큐레이션 값
})

test('큐레이션 맵에 있는 모델: 기존 행 없으면 큐레이션 값으로 채움', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', null)
  assert.equal(entry.label, 'Claude Opus 4.8')
  assert.equal(entry.contextLength, 200000)
  assert.equal(entry.capabilities.reasoning, true)
  assert.equal(entry.releasedAt, '2026-05-01')
  assert.equal(entry.isActive, true)
})

test('큐레이션 맵에 없는 모델: label prettify(빈칸 방지)·이름에 신호 없으면 능력 false, released null', () => {
  const entry = mergeModelCatalogEntry('openai', 'gpt-4-classic', null)
  assert.equal(entry.label, 'Gpt 4 Classic')                  // prettify로 빈칸 방지(raw modelId 아님)
  assert.equal(entry.contextLength, 128000)                    // openai 기본 컨텍스트 추론
  assert.deepEqual(entry.capabilities, { vision: false, longContext: false, reasoning: false }) // 이름에 멀티모달/추론 신호 없음
  assert.equal(entry.releasedAt, null)                         // 출시일 단서 없음
})

test('gpt-5 계열: 멀티모달·추론으로 표기하되 컨텍스트 길이는 날조하지 않는다', () => {
  const entry = mergeModelCatalogEntry('openai', 'gpt-5.5', null)
  assert.equal(entry.capabilities.vision, true)
  assert.equal(entry.capabilities.reasoning, true)
  // 세부 모델마다 다르므로 추론하지 않는다. 128,000 같은 확실치 않은 숫자를 화면에 띄우느니 빈칸.
  assert.equal(entry.contextLength, null)
})

test('기존 DB 행 값은 널로 덮어쓰지 않고 보존', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', {
    label: '커스텀 라벨',
    contextLength: 999,
    releasedAt: '2020-01-01',
  })
  assert.equal(entry.label, '커스텀 라벨')
  assert.equal(entry.contextLength, 999)
  assert.equal(entry.releasedAt, '2020-01-01')
  // capabilities는 기존 행에 없었으므로 큐레이션으로 보완됨
  assert.equal(entry.capabilities.reasoning, true)
})

test('기존 DB capabilities 부분값은 유지되고 나머지만 큐레이션으로 보완', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', {
    capabilities: { vision: false },
  })
  assert.equal(entry.capabilities.vision, false) // 기존값 보존(큐레이션 true를 덮어쓰지 않음)
  assert.equal(entry.capabilities.reasoning, true) // 큐레이션으로 보완
})

/* ── 명세가 카탈로그를 끌고 오는가 ─────────────────────────── */

test('큐레이션: 명세에 있는 공급자는 전부 자리가 있고 하나 이상 모델을 갖는다', () => {
  // 열쇠를 명세에서 받는다 — 여기에 다섯을 손으로 적으면 여섯째가 들어와도 이 단정은 모른다
  assert.deepEqual(Object.keys(CURATED_MODELS).sort(), [...AI_PROVIDER_IDS].sort())
  for (const id of AI_PROVIDER_IDS) {
    assert.ok(Object.keys(CURATED_MODELS[id]).length > 0, `${id}: 큐레이션 모델이 0개`)
  }
  // 새로 들어온 둘을 이름으로도 못 박는다
  assert.ok(Object.keys(CURATED_MODELS.groq).length > 0, 'groq')
  assert.ok(Object.keys(CURATED_MODELS.grok).length > 0, 'grok')
})

test('큐레이션: 이미지를 못 보내는 공급자의 모델은 이미지 읽기를 주장하지 않는다', () => {
  for (const spec of AI_PROVIDERS) {
    if (spec.capabilities.vision) continue
    for (const [modelId, info] of Object.entries(CURATED_MODELS[spec.id])) {
      assert.equal(info.capabilities.vision, false, `${spec.id}/${modelId}: 명세는 이미지를 못 보낸다고 적혀 있다`)
    }
  }
})

test('빈칸 없음: 다섯 공급자 전부 처음 보는 모델에도 라벨과 능력 세 값이 채워진다', () => {
  for (const id of AI_PROVIDER_IDS) {
    const entry = mergeModelCatalogEntry(id, `${id}-neverseen-1`, null)
    assert.equal(entry.provider, id)
    assert.ok(entry.label.length > 0, `${id}: 라벨 빈칸`)
    assert.notEqual(entry.label, `${id}-neverseen-1`, `${id}: 라벨이 원문 그대로`)
    for (const cap of ['vision', 'longContext', 'reasoning'] as const) {
      assert.equal(typeof entry.capabilities[cap], 'boolean', `${id}: capabilities.${cap} 빈칸`)
    }
    assert.equal(entry.isActive, true, `${id}: isActive`)
  }
})

test('빈칸 없음: 다섯 공급자의 기본 모델이 전부 병합을 통과한다', () => {
  for (const spec of AI_PROVIDERS) {
    if (!spec.defaultModel) continue // 관리자가 고르는 공급자는 기본값이 없다
    const entry = mergeModelCatalogEntry(spec.id, spec.defaultModel, null)
    assert.ok(entry.label.length > 0, `${spec.id}: ${spec.defaultModel} 라벨 빈칸`)
  }
})

test('추론: Groq 과 Grok 이 남의 공급자 규칙으로 읽히지 않는다', () => {
  // 예전엔 gemini 도 claude 도 아니면 전부 openai 규칙이라 Groq 모델이 128,000 토큰을 달고 나왔다
  assert.equal(inferModelMeta('groq', 'llama-3.1-70b-versatile').contextLength, undefined)
  assert.equal(inferModelMeta('groq', 'llama-3.1-70b-versatile').capabilities.longContext, true)
  // 공급자 천장은 열려 있지만(qwen 이 이미지를 먹는다) 이름만 보고 읽는다고 적지는 않는다.
  // 어느 모델이 읽는지는 공급자가 목록에서 말해 주고, 그때만 true 가 된다
  assert.equal(getProviderSpec('groq').capabilities.vision, true)
  assert.equal(inferModelMeta('groq', 'llama-4-scout-17b-vision').capabilities.vision, false)
  assert.equal(
    inferModelMeta('groq', 'llama-4-scout-17b-vision', {
      id: 'llama-4-scout-17b-vision', inputModalities: ['text', 'image'],
    }).capabilities.vision,
    true,
  )
  // Grok 은 mini 갈래만 이미지를 못 읽는다
  assert.equal(inferModelMeta('grok', 'grok-5').capabilities.vision, true)
  assert.equal(inferModelMeta('grok', 'grok-5-mini').capabilities.vision, false)
  assert.equal(inferModelMeta('grok', 'grok-5').capabilities.reasoning, true)
})

test('필터: Groq 목록에 섞여 오는 전사 전용 모델은 채팅 목록에서 빠진다', () => {
  assert.equal(isChatModel('groq', 'whisper-large-v3'), false)
  assert.equal(isChatModel('groq', 'whisper-large-v3-turbo'), false)
  assert.equal(isChatModel('groq', 'distil-whisper-large-v3-en'), false)
  assert.equal(isChatModel('groq', 'playai-tts'), false)
  assert.equal(isChatModel('groq', 'llama-3.3-70b-versatile'), true)
  assert.equal(isChatModel('grok', 'grok-4'), true)
})

/* ── 프로브가 명세의 주소로 가는가 ─────────────────────────── */

const AI_CHAT_DIR = fileURLToPath(new URL('./', import.meta.url))
const read = (rel: string) => readFileSync(AI_CHAT_DIR + rel, 'utf8')

test('프로브: 공급자별 분기 없이 명세의 baseUrl 로 간다', () => {
  // 프로브 유틸은 공급자를 모른다 — 아는 순간 공급자가 늘 때마다 여기도 고쳐야 한다
  const probe = read('probe-models.ts')
  for (const id of AI_PROVIDER_IDS) {
    assert.ok(!new RegExp(`['"\`]${id}['"\`]`).test(probe), `probe-models.ts 가 ${id} 를 직접 안다`)
  }

  // 주소는 명세에만 있다. 어댑터가 자기 주소를 또 적으면 둘이 갈린다
  const compat = read('providers/openai-compatible.ts')
  assert.match(compat, /spec\.baseUrl/)
  for (const spec of AI_PROVIDERS) {
    if (!spec.baseUrl) continue
    const host = new URL(spec.baseUrl).host
    for (const rel of ['providers/openai-compatible.ts', 'providers/groq.ts', 'providers/grok.ts', 'probe-models.ts']) {
      assert.ok(!read(rel).includes(host), `${rel} 에 ${host} 가 하드코딩됨`)
    }
  }
})

/* ── 공급자가 말해 준 것이 짐작보다 위인가 ──────────────────
   실측(2026-09-14): Groq 은 모델마다 input_modalities 와 context_window 를 준다.
   그걸 버리고 이름으로 점치던 동안 qwen/qwen3.6-27b 는 이미지를 읽는데 못 읽는다고 적혀 있었다. */

test('사실 우선: 공급자가 이미지를 먹는다고 하면 이름과 무관하게 읽는다고 적는다', () => {
  const entry = mergeModelCatalogEntry('groq', 'qwen/qwen3.6-27b', null, {
    id: 'qwen/qwen3.6-27b',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    contextWindow: 131072,
  })
  assert.equal(entry.capabilities.vision, true)
  assert.equal(entry.contextLength, 131072) // 비워 두던 자리를 공급자 값이 채운다
  assert.equal(entry.capabilities.longContext, true)
})

test('사실 우선: 글만 먹는 모델은 같은 공급자여도 이미지를 읽는다고 적지 않는다', () => {
  const entry = mergeModelCatalogEntry('groq', 'openai/gpt-oss-120b', null, {
    id: 'openai/gpt-oss-120b',
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextWindow: 131072,
  })
  assert.equal(entry.capabilities.vision, false)
  assert.equal(entry.contextLength, 131072)
})

test('사실 우선: 512 토큰짜리는 긴 컨텍스트라고 적지 않는다', () => {
  // meta-llama/llama-prompt-guard-2 계열은 분류기다. 글을 뱉으니 목록에는 남기되,
  // 512 토큰이라는 사실을 그대로 보여 사용자가 왜 이걸 못 쓰는지 알 수 있게 한다
  const entry = mergeModelCatalogEntry('groq', 'meta-llama/llama-prompt-guard-2-22m', null, {
    id: 'meta-llama/llama-prompt-guard-2-22m',
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextWindow: 512,
  })
  assert.equal(entry.contextLength, 512)
  assert.equal(entry.capabilities.longContext, false)
})

test('사실 우선: 공급자가 아무 말도 안 하면 예전처럼 이름으로 채운다', () => {
  const entry = mergeModelCatalogEntry('openai', 'gpt-4o', null)
  assert.equal(entry.capabilities.vision, true)
  assert.equal(entry.contextLength, 128000)
})

test('사실 우선: 이미지를 못 보내는 공급자에서는 목록이 뭐라 하든 읽는다고 적지 않는다', () => {
  // 명세가 천장을 닫아 둔 공급자는 어댑터가 이미지를 안 보낸다. 카드가 거짓말하면 안 된다
  const spec = getProviderSpec('openai')
  if (spec.capabilities.vision) return // openai 는 천장이 열려 있어 이 단정의 대상이 아니다
  const entry = mergeModelCatalogEntry('openai', 'whatever', null, { id: 'whatever', inputModalities: ['text', 'image'] })
  assert.equal(entry.capabilities.vision, false)
})
