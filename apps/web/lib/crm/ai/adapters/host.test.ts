/**
 * CRM 어댑터가 **공급자를 넘는지** 잠근다
 *
 * ## 왜 이 파일이 생겼나 (실측 2026-09-19)
 *
 * 견적서 파일을 올렸더니 「AI 사용량 한도를 초과했습니다」가 떴다. 그 순간 OpenAI 키는
 * 등록돼 있었고 멀쩡했다. 어댑터가 **Gemini 모델만 담긴 자기 사슬**을 만들고,
 * 429(= 그 키로는 뭘 해도 안 된다)를 「다른 모델을 시도하라」로 읽었기 때문이다.
 * Gemini 모델 다섯을 차례로 때려 429 를 다섯 번 맞고 포기했다.
 *
 * 그 판단의 SSOT 는 이미 있었다 — `provider-errors.ts` 의 `scope` 와
 * `model-chain.ts` 의 `buildModelChain`/`pruneChain`. AI 채팅과 심층분석은 이미 그것을 탄다.
 * **CRM 만 밖에 있었다.**
 *
 * 실제 호출은 여기서 안 돈다(키가 필요하다). 잠그는 것은 **어느 SSOT 를 쓰는가**다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { classifyProviderError } from '../../../ai-chat/provider-errors.ts'
import { pruneChain, type ChainCandidate } from '../../../ai-chat/model-chain.ts'

const SRC = readFileSync(new URL('./host.ts', import.meta.url), 'utf-8')

/* ── 어느 SSOT 를 쓰나 ───────────────────────────── */

test('★ 후보 순서를 공용 SSOT 로 만든다 — 자작 사슬이 이 사고의 원인이었다', () => {
  assert.match(SRC, /buildModelChain\(/, '체인 SSOT 를 안 쓴다')
  assert.ok(
    !/resolveGeminiModelChain/.test(SRC),
    'Gemini 만 담긴 자작 사슬로 되돌아갔다 — 429 에서 같은 키를 다섯 번 때린다',
  )
})

test('★ 실패하면 scope 로 남은 후보를 쳐낸다 — 안 하면 같은 공급자에서 또 429 를 맞는다', () => {
  assert.match(SRC, /pruneChain\(rest, cand, scope\)/)
  assert.match(SRC, /classifyProviderError\(e\)/)
  // 예전 판정: availability === 'limited' 를 「다른 모델 시도」로 읽었다
  assert.ok(
    !/worthAnotherModel/.test(SRC),
    "availability 로 판정하면 429(scope=provider)가 같은 공급자 안에서 돈다",
  )
})

test('★ 능력을 못 채우는 후보는 뺀다 — 못 보는 모델에 그림을 보내 봐야 400 이다', () => {
  assert.match(SRC, /vision: attachments\.length > 0/)
  assert.match(SRC, /tools: webSearch/)
  // buildModelChain 은 «고른 것»만은 능력과 무관하게 넣는다. 그 하나까지 거른다
  assert.match(SRC, /meetsRequirements\(capabilities\[c\.provider\], requires\)/)
})

test('★ 후보가 0개면 조용히 끝내지 않고 무엇이 모자란지 말한다', () => {
  assert.match(SRC, /chain\.length === 0/)
  assert.match(SRC, /그림을 읽을 수 있는 AI 모델이 없습니다/)
  assert.match(SRC, /웹 검색을 할 수 있는 AI 모델이 없습니다/)
})

test('★ 실제로 답한 후보를 돌려준다 — 고른 것을 기록하면 사용량 집계가 거짓이 된다', () => {
  assert.match(SRC, /usedProvider: used\?\.provider/)
  assert.match(SRC, /usedModel: used\?\.model/)
})

test('★ 전부 한도면 그렇다고 말한다 — 「응답 실패」로는 기다려야 하는지 키를 넣어야 하는지 모른다', () => {
  assert.match(SRC, /PROVIDER_QUOTA/)
  assert.match(SRC, /등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다/)
})

test('카탈로그는 주입받는다 — 이 파일은 DB 를 모른다', () => {
  assert.match(SRC, /readCatalog: CatalogReader = async \(\) => \[\]/)
  assert.ok(!/createAdminClient|from\('ai_model_catalog'\)/.test(SRC), '어댑터가 DB 를 직접 연다')
})

/* ── 쳐내는 규칙이 실제로 공급자를 건너뛰나 ──────── */

const c = (provider: string, model: string): ChainCandidate =>
  ({ provider: provider as ChainCandidate['provider'], model, apiKey: 'k' })

test('★ 429 는 그 공급자를 통째로 건너뛴다 — 이번 사고의 정확한 반대', () => {
  const chain = [c('gemini', 'a'), c('gemini', 'b'), c('gemini', 'c'), c('openai', 'x')]
  const err = new Error('429 Too Many Requests: quota exceeded')
  const { scope } = classifyProviderError(err)
  assert.equal(scope, 'provider', '429 를 provider 범위로 안 본다')

  const rest = pruneChain(chain.slice(1), chain[0], scope)
  assert.deepEqual(rest.map((x) => `${x.provider}:${x.model}`), ['openai:x'],
    'Gemini 가 429 인데 Gemini 남은 모델이 후보에 남았다')
})

test('404 는 그 모델만 건너뛴다 — 같은 공급자의 다른 모델은 살아 있다', () => {
  const chain = [c('gemini', 'a'), c('gemini', 'b'), c('openai', 'x')]
  const { scope } = classifyProviderError(new Error('404 model not found'))
  assert.equal(scope, 'model')
  const rest = pruneChain(chain.slice(1), chain[0], scope)
  assert.deepEqual(rest.map((x) => x.model), ['b', 'x'])
})

test('키 문제는 그 공급자를 건너뛴다 — 모델을 바꿔도 같은 답이 온다', () => {
  assert.equal(classifyProviderError(new Error('401 invalid api key')).scope, 'provider')
})
