import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openaiProvider } from './openai.ts'
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
