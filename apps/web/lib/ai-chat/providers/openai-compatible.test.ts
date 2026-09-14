import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openaiProvider } from './openai.ts'
import { byOutputModality, byNamePattern, type ListedModel } from './openai-compatible.ts'
import { groqProvider } from './groq.ts'
import { grokProvider } from './grok.ts'
import { toOpenAiMessages } from './openai-messages.ts'
import { getProviderSpec } from '../../ai/provider-catalog.ts'
import { getProvider } from '../registry.ts'
import { AI_PROVIDER_IDS } from '../../ai/provider-catalog.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/* ── 셋이 정말 한 팩토리에서 나오는가 ─────────────────────── */

// 「같은 팩토리를 쓴다」를 눈으로만 확인하면, 나중에 누가 한 벌을 복사해 고쳐도 아무도 모른다.
// 파일이 팩토리 호출 한 줄로 되어 있는지를 본다.
test('세 어댑터가 전부 팩토리 호출로만 되어 있다', () => {
  for (const f of ['openai.ts', 'groq.ts', 'grok.ts']) {
    const src = readFileSync(HERE + f, 'utf8')
    assert.match(src, /createOpenAiCompatibleProvider\(/, `${f}: 팩토리를 안 부름`)
    // 자기 streamChat 을 다시 구현했으면 팩토리를 쓴 게 아니다
    assert.doesNotMatch(src, /async function streamChat/, `${f}: 구현을 또 적음`)
    assert.doesNotMatch(src, /new OpenAI\(/, `${f}: 클라이언트를 직접 만듦`)
  }
})

test('셋의 차이는 주소뿐이다', () => {
  assert.equal(getProviderSpec('openai').baseUrl, null) // SDK 기본 주소
  assert.equal(getProviderSpec('groq').baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(getProviderSpec('grok').baseUrl, 'https://api.x.ai/v1')
})

/* ── 능력을 어댑터가 또 적지 않는가 ────────────────────────── */

test('어댑터 능력은 명세에서 온다', () => {
  for (const p of [openaiProvider, groqProvider, grokProvider]) {
    assert.deepEqual(p.capabilities, getProviderSpec(p.id).capabilities, `${p.id}: 능력이 명세와 다름`)
  }
})

test('라벨도 명세에서 온다', () => {
  assert.equal(groqProvider.label, getProviderSpec('groq').label)
  assert.equal(grokProvider.label, getProviderSpec('grok').label)
})

// Groq 은 이미지도 도구도 안 된다. 카드에 「이미지 읽기」가 뜨면 사용자는 사진을 올리고
// 아무 일도 안 일어나는 것을 본다.
test('Groq 은 이미지 읽기와 도구가 꺼져 있다', () => {
  assert.equal(groqProvider.capabilities.vision, false)
  assert.equal(groqProvider.capabilities.tools, false)
})

/* ── 다섯 전부 배선됐는가 ──────────────────────────────────── */

test('getProvider 가 다섯 id 전부에 어댑터를 돌려준다', () => {
  for (const id of AI_PROVIDER_IDS) {
    const p = getProvider(id)
    assert.equal(p.id, id)
    assert.equal(typeof p.streamChat, 'function', `${id}: streamChat 없음`)
    assert.equal(typeof p.listModels, 'function', `${id}: listModels 없음`)
    assert.equal(typeof p.probeModel, 'function', `${id}: probeModel 없음`)
  }
})

test('배선되지 않은 id 는 조용히 넘어가지 않는다', () => {
  // @ts-expect-error 런타임 방어를 확인한다
  assert.throws(() => getProvider('mistral'), /배선되지 않은/)
})

/* ── 메시지 조립은 그대로인가 ──────────────────────────────── */

test('메시지 조립: system 이 첫 원소로 들어간다', () => {
  const out = toOpenAiMessages('너는 도우미다', [{ role: 'user', content: '안녕' }])
  assert.deepEqual(out, [
    { role: 'system', content: '너는 도우미다' },
    { role: 'user', content: '안녕' },
  ])
})

test('메시지 조립: system 이 없으면 넣지 않는다', () => {
  const out = toOpenAiMessages(undefined, [{ role: 'user', content: '안녕' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'user')
})

/* ── 채팅 모델 고르기: 짐작이 아니라 공급자의 답 ────────────
   아래 목록은 2026-09-14 실제 Groq 계정이 내려준 14개 그대로다.
   예전 이름 규칙은 이 중 5개만 통과시켜 groq/compound 와 allam-2-7b 를 버리고 있었다. */

const GROQ_REAL_LIST: ListedModel[] = [
  { id: 'allam-2-7b', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'canopylabs/orpheus-arabic-saudi', input_modalities: ['text'], output_modalities: ['speech'] },
  { id: 'canopylabs/orpheus-v1-english', input_modalities: ['text'], output_modalities: ['speech'] },
  { id: 'groq/compound', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'groq/compound-mini', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'meta-llama/llama-prompt-guard-2-22m', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'meta-llama/llama-prompt-guard-2-86m', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'openai/gpt-oss-120b', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'openai/gpt-oss-20b', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'openai/gpt-oss-safeguard-20b', input_modalities: ['text'], output_modalities: ['text'] },
  { id: 'qwen/qwen3.6-27b', input_modalities: ['text', 'image'], output_modalities: ['text'] },
  { id: 'qwen/qwen3.8-27b', input_modalities: ['text', 'image'], output_modalities: ['text'] },
  { id: 'whisper-large-v3', input_modalities: ['audio'], output_modalities: ['transcription'] },
  { id: 'whisper-large-v3-turbo', input_modalities: ['audio'], output_modalities: ['transcription'] },
]

const OLD_NAME_RULE = /^(llama|mixtral|gemma|qwen|deepseek|kimi|moonshot|openai\/)/i

test('고르기: 옛 이름 규칙이 실제 Groq 목록에서 채팅 모델을 버렸다 (회귀 증거)', () => {
  const kept = GROQ_REAL_LIST.filter((m) => OLD_NAME_RULE.test(m.id)).map((m) => m.id)
  assert.equal(kept.length, 5, '실측 당시 5개만 통과했다')
  // 버려진 것들이 진짜 채팅 모델이었다는 사실을 못 박는다
  for (const dropped of ['groq/compound', 'groq/compound-mini', 'allam-2-7b']) {
    assert.ok(!kept.includes(dropped), `${dropped} 는 옛 규칙이 버리던 것이다`)
  }
})

test('고르기: 공급자가 뱉는 것을 말해 주면 그 답을 쓴다', () => {
  const select = byOutputModality(OLD_NAME_RULE)
  const kept = GROQ_REAL_LIST.filter(select).map((m) => m.id)

  // 말 상대가 되는 모델은 글을 뱉는다
  assert.equal(kept.length, 10, `통과 목록이 달라졌다: ${kept.join(', ')}`)
  for (const id of ['groq/compound', 'groq/compound-mini', 'allam-2-7b', 'qwen/qwen3.6-27b']) {
    assert.ok(kept.includes(id), `${id} 가 빠졌다`)
  }
})

test('고르기: 전사 전용과 읽어 주는 모델은 채팅 목록에 섞이지 않는다', () => {
  const select = byOutputModality(OLD_NAME_RULE)
  const kept = GROQ_REAL_LIST.filter(select).map((m) => m.id)
  // 받아쓰기를 뱉는다 = 회의 녹음을 글로 옮기는 모델
  assert.ok(!kept.includes('whisper-large-v3'))
  assert.ok(!kept.includes('whisper-large-v3-turbo'))
  // 소리를 뱉는다 = 읽어 주는 모델
  assert.ok(!kept.includes('canopylabs/orpheus-v1-english'))
  assert.ok(!kept.includes('canopylabs/orpheus-arabic-saudi'))
})

test('고르기: 뱉는 것을 말해 주지 않는 공급자는 이름 규칙으로 떨어진다', () => {
  // OpenAI 는 목록에 id 와 주인만 준다
  const select = byOutputModality(/^(gpt|o\d|chatgpt)/i)
  assert.equal(select({ id: 'gpt-4o' }), true)
  assert.equal(select({ id: 'text-embedding-3-large' }), false)
  // 빈 배열도 「답이 없다」로 본다 — 빈 답을 답으로 믿으면 전부 사라진다
  assert.equal(select({ id: 'gpt-4o', output_modalities: [] }), true)
})

test('고르기: 이름 규칙만 쓰는 공급자는 모델 객체를 받아도 이름만 본다', () => {
  const select = byNamePattern(/^grok/i)
  assert.equal(select({ id: 'grok-4' }), true)
  assert.equal(select({ id: 'whisper-large-v3' }), false)
})
