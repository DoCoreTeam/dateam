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
  // 모델 **이름**을 여기 박지 않는다. Groq 은 모델을 자주 갈아 치우고,
  // 이름을 박으면 명세를 고칠 때마다 이 단정이 함께 틀린다.
  // 지켜야 하는 것은 「기본 모델이 명세에서 온다」다
  assert.equal(list[0].model, DEFAULT_MODELS.groq)
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

/* ── 채팅 스트림이 키를 갈아타는가 ──────────────────────────────
   이 라우트는 사람이 글자가 흘러나오는 것을 보고 있는 자리다. 키가 마르면
   화면은 그냥 멈춘 것처럼 보이고, 등록해 둔 다른 키는 한 번도 안 쓰인다.
   실행으로 밟기 어려운 자리(대화·스트림·관리자 세션)라 배선을 센다. */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_CHAIN_CANDIDATES, MAX_PER_PROVIDER } from './model-chain.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUTE = readFileSync(join(WEB, 'app/api/admin/ai-chat/stream/route.ts'), 'utf8')

test('★ 후보를 버리기 전에 같은 공급자 같은 모델을 다음 키로 부른다', () => {
  assert.match(ROUTE, /withProviderKeys\(cand\.provider, cand\.apiKey/,
    '키 교체 없이 pruneChain 으로 내려가면 그 공급자가 통째로 빠지고 다른 키는 안 쓰인다')
  // 교체는 **그 후보 안에서** 일어나야 한다 — 모델이 바뀌면 답의 성격이 달라진다
  const i = ROUTE.indexOf('withProviderKeys(cand.provider')
  assert.match(ROUTE.slice(i, i + 400), /model: cand\.model/)
})

test('★ 키 목록과 결말 기록이 저장소 한 곳을 지난다 — 라우트가 표를 직접 열지 않는다', () => {
  assert.match(ROUTE, /readKeyPool\(cand\.provider\)/)
  assert.match(ROUTE, /record: recordKeyOutcome/)
  assert.ok(!ROUTE.includes("from('ai_provider_keys')"), '표를 직접 열면 원문 키가 흩어진다')
})

test('★ 키 교체가 후보 수를 늘리지 않는다 — 사슬 상한은 그대로다', () => {
  assert.equal(MAX_CHAIN_CANDIDATES, 6)
  assert.equal(MAX_PER_PROVIDER, 2)
  assert.ok(!/maxCandidates:/.test(ROUTE), '라우트가 상한을 따로 올리면 기다리는 시간이 늘어난다')
  assert.ok(!/maxPerProvider:/.test(ROUTE))
})

test('★ 키를 갈아탄 사실이 사용자에게 보이는 말로 남는다', () => {
  const i = ROUTE.indexOf('onSwitch:')
  assert.ok(i > 0, '갈아타는 자리에 알림이 없으면 화면은 멈춘 것처럼 보인다')
  const block = ROUTE.slice(i, i + 500)
  assert.match(block, /enqueue\(\{[\s\S]{0,200}switched:/)
  assert.match(block, /reset: emittedAny/, '앞 키가 흘린 조각은 다음 키의 답이 아니다')
})

test('★ 갈아탐 안내에 키 이름만 나간다 — 원문 키는 화면으로 나가지 않는다', () => {
  const i = ROUTE.indexOf('onSwitch:')
  const block = ROUTE.slice(i, i + 500)
  assert.match(block, /from\.label/)
  assert.match(block, /to\.label/)
  assert.ok(!/from\.apiKey|to\.apiKey/.test(block), '가림값도 아닌 원문이 스트림에 실린다')
})

test('★ 스트림 어디에도 키가 실리지 않는다 — enqueue 전수', () => {
  const offenders = [...ROUTE.matchAll(/enqueue\(\{[\s\S]{0,300}?\}\)/g)]
    .map((m) => m[0])
    .filter((call) => /apiKey|api_key/.test(call))

  assert.deepEqual(offenders, [], '스트림으로 나가는 조각에 키가 섞였다')
})

test('★ 인증 장치가 그대로 맨 앞에 있다 — 관리자 확인 없이 부를 수 없다', () => {
  const gate = ROUTE.indexOf('requireAdminApi')
  assert.ok(gate > 0, '관리자 확인이 사라졌다')
  // 서비스롤을 쓰는 자리보다 **앞**이어야 한다. 뒤면 확인 전에 RLS 를 지나간다
  assert.ok(gate < ROUTE.indexOf('createAdminClient('),
    '사람 확인보다 서비스롤이 먼저 서면 그 확인은 아무것도 막지 않는다')
})
