import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildModelChain,
  pruneChain,
  formatFallbackNotice,
  MAX_CHAIN_CANDIDATES,
  type ChainCandidate,
  type ChainProviderConfig,
  type ChainCatalogEntry,
} from './model-chain.ts'
import type { ProviderId } from './provider.ts'
import { getProviderOrder, getAvailableProviders, META_PROVIDER_ORDER_KEY } from './registry.ts'
import { AI_PROVIDER_IDS } from '../ai/provider-catalog.ts'

const CAPS = {
  gemini: { vision: true, tools: true },
  claude: { vision: true, tools: false },
  openai: { vision: true, tools: false },
} as const

const PROVIDERS: ChainProviderConfig[] = [
  { id: 'gemini', apiKey: 'k-gemini', model: 'gemini-3.6-flash' },
  { id: 'claude', apiKey: 'k-claude', model: 'claude-opus-4-8' },
  { id: 'openai', apiKey: 'k-openai', model: 'gpt-4o' },
]

function chain(over: Partial<Parameters<typeof buildModelChain>[0]> = {}) {
  return buildModelChain({
    chosen: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
    providers: PROVIDERS,
    catalog: [],
    capabilities: CAPS,
    ...over,
  })
}

const ids = (c: ChainCandidate[]) => c.map((x) => `${x.provider}:${x.model}`)

test('고른 모델이 언제나 1순위 — 카탈로그에 없어도 존중한다', () => {
  assert.equal(ids(chain())[0], 'gemini:gemini-3.1-pro-preview')
})

test('고른 뒤에는 다른 공급자로 넘어간다 — 키가 있는 공급자만', () => {
  const got = ids(chain())
  assert.ok(got.includes('claude:claude-opus-4-8'), got.join(' '))
  assert.ok(got.includes('openai:gpt-4o'), got.join(' '))
})

test('키가 없는 공급자는 후보에 없다 — providers 배열이 곧 가용 목록이다', () => {
  const got = ids(chain({ providers: [PROVIDERS[0]] }))
  assert.deepEqual(
    got.filter((g) => !g.startsWith('gemini:')),
    [],
  )
})

test('카탈로그가 unavailable 이라고 한 고른 모델은 후보에서 빠진다', () => {
  const catalog: ChainCatalogEntry[] = [
    { provider: 'gemini', model_id: 'gemini-3.1-pro-preview', availability: 'unavailable' },
  ]
  const got = ids(chain({ catalog }))
  assert.ok(!got.includes('gemini:gemini-3.1-pro-preview'), got.join(' '))
})

test('is_active=false 인 모델도 후보에서 빠진다', () => {
  const catalog: ChainCatalogEntry[] = [
    { provider: 'gemini', model_id: 'gemini-3.1-pro-preview', is_active: false },
    { provider: 'gemini', model_id: 'gemini-3.6-flash', is_active: false },
  ]
  const got = ids(chain({ catalog }))
  assert.ok(!got.some((g) => g.startsWith('gemini:')), got.join(' '))
})

test('한도에 걸렸던(limited) 모델은 빼지 않고 뒤로 민다', () => {
  const catalog: ChainCatalogEntry[] = [
    { provider: 'gemini', model_id: 'gemini-limited', availability: 'limited' },
    { provider: 'gemini', model_id: 'gemini-ok', availability: 'available' },
  ]
  const got = ids(chain({ catalog, maxPerProvider: 3 }))
  assert.ok(got.indexOf('gemini:gemini-ok') < got.indexOf('gemini:gemini-limited'), got.join(' '))
  assert.ok(got.includes('gemini:gemini-limited'))
})

test('첨부가 있으면 vision 없는 공급자는 통째로 빠진다', () => {
  const caps = { ...CAPS, claude: { vision: false, tools: false } }
  const got = ids(chain({ capabilities: caps, requires: { vision: true } }))
  assert.ok(!got.some((g) => g.startsWith('claude:')), got.join(' '))
})

test('웹 검색을 요청하면 tools 없는 공급자는 통째로 빠진다', () => {
  const got = ids(chain({ requires: { tools: true } }))
  assert.ok(!got.some((g) => g.startsWith('claude:')), got.join(' '))
  assert.ok(!got.some((g) => g.startsWith('openai:')), got.join(' '))
})

test('공급자당 상한을 넘기지 않는다 — 죽은 공급자로 체인을 다 채우지 않게', () => {
  const catalog: ChainCatalogEntry[] = Array.from({ length: 9 }, (_, i) => ({
    provider: 'gemini',
    model_id: `gemini-${i}`,
  }))
  const got = chain({ catalog })
  const gemini = got.filter((c) => c.provider === 'gemini')
  assert.equal(gemini.length, 2)
})

test('전체 상한을 넘기지 않는다', () => {
  const catalog: ChainCatalogEntry[] = Array.from({ length: 9 }, (_, i) => ({
    provider: 'claude',
    model_id: `claude-${i}`,
  }))
  const got = chain({ catalog, maxPerProvider: 99 })
  assert.ok(got.length <= MAX_CHAIN_CANDIDATES, `${got.length}`)
})

test('같은 공급자·모델이 두 번 들어가지 않는다', () => {
  const catalog: ChainCatalogEntry[] = [
    { provider: 'gemini', model_id: 'gemini-3.1-pro-preview' },
    { provider: 'gemini', model_id: 'gemini-3.6-flash' },
  ]
  const got = ids(chain({ catalog }))
  assert.equal(new Set(got).size, got.length, got.join(' '))
})

test('후보는 키를 함께 들고 나온다 — 호출측이 다시 찾지 않게', () => {
  const got = chain()
  assert.equal(got[0].apiKey, 'k-gemini')
  assert.equal(got.find((c) => c.provider === 'claude')?.apiKey, 'k-claude')
})

test('쓸 수 있는 공급자가 0개면 후보도 0개 — 조용히 아무거나 고르지 않는다', () => {
  assert.deepEqual(chain({ providers: [] }), [])
})

// ── pruneChain ──

const REST: ChainCandidate[] = [
  { provider: 'gemini', model: 'a', apiKey: 'k' },
  { provider: 'gemini', model: 'b', apiKey: 'k' },
  { provider: 'claude', model: 'c', apiKey: 'k2' },
]

test('pruneChain: provider 범위 실패는 그 공급자를 통째로 뺀다 (429는 모델을 바꿔도 소용없다)', () => {
  const got = pruneChain(REST, { provider: 'gemini', model: 'a', apiKey: 'k' }, 'provider')
  assert.deepEqual(ids(got), ['claude:c'])
})

test('pruneChain: model 범위 실패는 그 모델만 뺀다', () => {
  const got = pruneChain(REST, { provider: 'gemini', model: 'a', apiKey: 'k' }, 'model')
  assert.deepEqual(ids(got), ['gemini:b', 'claude:c'])
})

test('pruneChain: 원인 불명이면 시도한 것만 뺀다', () => {
  const got = pruneChain(REST, { provider: 'gemini', model: 'a', apiKey: 'k' }, 'transient')
  assert.deepEqual(ids(got), ['gemini:b', 'claude:c'])
})

test('pruneChain: 입력 배열을 바꾸지 않는다', () => {
  pruneChain(REST, { provider: 'gemini', model: 'a', apiKey: 'k' }, 'provider')
  assert.equal(REST.length, 3)
})

// ── formatFallbackNotice ──

test('갈아탄 알림에 원래 것과 실제 답한 것이 둘 다 들어간다', () => {
  const msg = formatFallbackNotice({
    fromLabel: 'Gemini',
    fromModel: 'gemini-3.1-pro-preview',
    toLabel: 'Claude',
    toModel: 'claude-opus-4-8',
  })
  assert.match(msg, /Gemini gemini-3\.1-pro-preview/)
  assert.match(msg, /Claude claude-opus-4-8/)
})

test('타입 확인용 — ProviderId 밖의 값은 후보에 못 들어온다', () => {
  const p: ProviderId = 'gemini'
  assert.equal(chain({ chosen: { provider: p, model: 'x' } })[0].provider, 'gemini')
})

// ── 배선 가드: 만들고 안 부르면 없는 기능이다 ──

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const STREAM = 'app/api/admin/ai-chat/stream/route.ts'
const ANALYZE = 'lib/ai-chat/analyze-gemini.ts'
const CLIENT = 'app/(ai)/ai/AiChatClient.tsx'
const BUBBLE = 'app/(ai)/ai/MessageBubble.tsx'

test('★ 스트림 라우트가 체인을 실제로 만들고 순서대로 시도한다', () => {
  const src = read(STREAM)
  assert.match(src, /buildModelChain\(/)
  assert.match(src, /pruneChain\(/)
  assert.match(src, /while \(rest\.length > 0\)/)
})

test('★ 후보가 하나도 없으면 조용히 끝내지 않고 사용자에게 말한다', () => {
  assert.match(read(STREAM), /chain\.length === 0/)
})

test('★ 사용자 Stop 은 폴백 대상이 아니다 — 다음 모델을 불러 봐야 돈만 쓴다', () => {
  assert.match(read(STREAM), /if \(req\.signal\.aborted\) throw err/)
})

test('★ 실제로 답한 공급자·모델을 기록한다 — 사용량 집계가 거짓이 되면 안 된다', () => {
  const src = read(STREAM)
  assert.match(src, /providerName = cand\.provider/)
  assert.match(src, /model = cand\.model/)
})

test('★ 옛 사전 차단(409)이 되살아나지 않는다 — 그게 막다른 안내의 정체였다', () => {
  const src = read(STREAM)
  assert.doesNotMatch(src, /getModelSelectionError/)
  assert.doesNotMatch(src, /status: 409/)
})

test('★ 심층분석도 같은 체인을 탄다 — 여기만 빠지면 429 하나에 통째로 죽는다', () => {
  const src = read(ANALYZE)
  assert.match(src, /buildModelChain\(/)
  assert.match(src, /pruneChain\(/)
})

test('★ 화면이 갈아탄 사실을 받아 그린다 — 조용히 바꾸지 않는다', () => {
  assert.match(read(CLIENT), /onSwitch:/)
  assert.match(read(BUBBLE), /fallbackNotice/)
})

test('★ 저장된 답도 갈아탄 사실을 되살린다 — 새로고침하면 사라지면 안 된다', () => {
  const src = read(BUBBLE)
  assert.match(src, /chosen/)
  assert.match(src, /message\.provider !== chosen\.provider/)
})

test('★ 자동 폴백은 대화용이 아닌 모델로 갈아타지 않는다 (실측 v0.7.716 Gemma 사고)', () => {
  const catalog: ChainCatalogEntry[] = [
    { provider: 'gemini', model_id: 'gemma-4-26b-a4b-it' },
    { provider: 'gemini', model_id: 'text-embedding-004' },
    { provider: 'gemini', model_id: 'gemini-2.5-flash' },
  ]
  const got = ids(chain({ catalog, maxPerProvider: 9 }))
  assert.ok(!got.includes('gemini:gemma-4-26b-a4b-it'), got.join(' '))
  assert.ok(!got.includes('gemini:text-embedding-004'), got.join(' '))
  assert.ok(got.includes('gemini:gemini-2.5-flash'), got.join(' '))
})

/* ── 폴백 순서가 한 값에서 오는가 ────────────────────────────
   순서는 META 한 곳(ai_chat_provider_order)에서 오고, 화면과 체인이 같은 것을 본다. */

test('순서: 저장된 순서가 명세 기본 순서를 이긴다', () => {
  const meta = { [META_PROVIDER_ORDER_KEY]: ['grok', 'groq', 'gemini'] }
  const order = getProviderOrder(meta)
  assert.deepEqual(order.slice(0, 3), ['grok', 'groq', 'gemini'])
})

test('순서: 저장된 순서에 없는 공급자는 명세 순서대로 뒤에 붙는다', () => {
  // 공급자를 하나 더해도 순서가 비지 않아야 한다 — 조용히 빠지면 아무도 모른다
  const meta = { [META_PROVIDER_ORDER_KEY]: ['grok'] }
  const order = getProviderOrder(meta)
  assert.equal(order[0], 'grok')
  assert.deepEqual([...order].sort(), [...AI_PROVIDER_IDS].sort(), '다섯이 전부 순서에 있어야 한다')
  // 뒤에 붙는 부분은 명세 순서 그대로
  assert.deepEqual(order.slice(1), AI_PROVIDER_IDS.filter((id) => id !== 'grok'))
})

test('순서: 저장값이 없으면 명세 순서 그대로', () => {
  assert.deepEqual(getProviderOrder({}), [...AI_PROVIDER_IDS])
})

test('순서: 키가 있는 공급자만 후보에 들어간다', () => {
  const meta = {
    [META_PROVIDER_ORDER_KEY]: ['grok', 'gemini'],
    xai_api_key: 'xai-' + 'x'.repeat(40),
    // gemini 키는 없다
  }
  const ids = getAvailableProviders(meta).map((p) => p.id)
  assert.ok(ids.includes('grok'), 'grok 은 키가 있으니 들어와야 한다')
  assert.ok(!ids.includes('gemini'), 'gemini 는 키가 없으니 빠져야 한다')
  assert.equal(ids[0], 'grok', '순서 맨 앞이 먼저 온다')
})

test('순서: 순서를 바꾸면 체인이 그 순서대로 갈아탄다', () => {
  const chosen = { provider: 'gemini' as ProviderId, model: 'gemini-3.6-flash' }
  const forward = buildModelChain({
    chosen,
    providers: PROVIDERS,
    catalog: [],
    capabilities: CAPS,
  })
  const reversed = buildModelChain({
    chosen,
    providers: [...PROVIDERS].reverse(),
    catalog: [],
    capabilities: CAPS,
  })
  // 고른 것은 둘 다 맨 앞
  assert.equal(forward[0].provider, 'gemini')
  assert.equal(reversed[0].provider, 'gemini')
  // 다음으로 넘어가는 공급자는 순서를 따른다
  const nextOf = (chain: ChainCandidate[]) => chain.find((c) => c.provider !== 'gemini')?.provider
  assert.equal(nextOf(forward), 'claude')
  assert.equal(nextOf(reversed), 'openai', '순서를 뒤집으면 갈아타는 곳도 뒤집힌다')
})
