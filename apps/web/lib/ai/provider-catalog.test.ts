import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  getProviderSpec,
  deriveLabels,
  deriveMetaKeys,
  deriveDefaultModels,
  deriveOrder,
  matchesKeyPrefix,
  type AiProviderSpec,
} from './provider-catalog.ts'

/* ── 명세가 다섯을 다 갖는가 ──────────────────────────────── */

test('명세: 다섯 공급자가 순서대로 있다', () => {
  assert.deepEqual(AI_PROVIDER_IDS, ['gemini', 'claude', 'openai', 'groq', 'grok'])
})

test('명세: 공급자마다 아홉 자리가 전부 채워져 있다', () => {
  for (const spec of AI_PROVIDERS) {
    assert.ok(spec.id, `${spec.id}: id`)
    assert.ok(spec.label, `${spec.id}: label`)
    assert.ok(spec.meta.apiKey, `${spec.id}: meta.apiKey`)
    assert.ok(spec.meta.model, `${spec.id}: meta.model`)
    // baseUrl 은 공식 SDK 를 쓰는 곳에서 null 이다 — 자리는 반드시 선언되어야 한다
    assert.ok('baseUrl' in spec, `${spec.id}: baseUrl 자리 없음`)
    assert.ok(spec.keyPrefixes.length > 0, `${spec.id}: keyPrefixes`)
    assert.ok('defaultModel' in spec, `${spec.id}: defaultModel 자리 없음`)
    assert.equal(typeof spec.capabilities.vision, 'boolean', `${spec.id}: capabilities.vision`)
    assert.ok(spec.purpose.length > 0, `${spec.id}: purpose`)
    assert.ok(/^https:\/\//.test(spec.keyIssueUrl), `${spec.id}: keyIssueUrl`)
  }
})

/* ── 이미 연결된 키를 잃지 않는가 ──────────────────────────── */

// Groq 키는 「음성 인식」 카드에서 stt_api_key 로 저장돼 이미 조직에 들어 있다.
// 여기서 이름을 groq_api_key 로 바꾸면 이미 연결된 키가 그날로 끊어진다.
test('명세: groq 의 META 키는 이미 저장된 stt_api_key 를 승계한다', () => {
  assert.equal(getProviderSpec('groq').meta.apiKey, 'stt_api_key')
})

test('명세: grok 의 META 키는 xai_api_key 다', () => {
  assert.equal(getProviderSpec('grok').meta.apiKey, 'xai_api_key')
})

test('명세: groq 은 회의 전사에도 쓰인다는 사실을 갖는다', () => {
  const groq = getProviderSpec('groq')
  assert.ok(groq.alsoUsedFor && groq.alsoUsedFor.length > 0)
})

test('명세: 없는 공급자를 물으면 던진다', () => {
  // @ts-expect-error 런타임 방어를 확인한다
  assert.throws(() => getProviderSpec('mistral'))
})

/* ── OpenAI 호환은 baseUrl 을 갖는가 ──────────────────────── */

test('명세: groq 과 grok 은 OpenAI 호환 주소를 갖고 gemini 와 claude 는 안 갖는다', () => {
  assert.equal(getProviderSpec('groq').baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(getProviderSpec('grok').baseUrl, 'https://api.x.ai/v1')
  assert.equal(getProviderSpec('gemini').baseUrl, null)
  assert.equal(getProviderSpec('claude').baseUrl, null)
})

// sk- 는 sk-ant- 를 통째로 포함한다. 접두사만 그대로 비교하면 Claude 키를 OpenAI 칸에
// 붙여 넣어도 저장이 되고, 실패는 첫 호출에서야 나온다.
test('키 검증: 더 긴 접두사를 가진 공급자가 이긴다', () => {
  assert.equal(matchesKeyPrefix('claude', 'sk-ant-api03-xxx'), true)
  assert.equal(matchesKeyPrefix('openai', 'sk-ant-api03-xxx'), false)
  assert.equal(matchesKeyPrefix('openai', 'sk-proj-xxx'), true)
})

test('키 검증: 남의 접두사는 거부한다', () => {
  assert.equal(matchesKeyPrefix('gemini', 'gsk_xxx'), false)
  assert.equal(matchesKeyPrefix('groq', 'AIzaxxx'), false)
  assert.equal(matchesKeyPrefix('grok', 'xai-xxx'), true)
})

test('키 검증: 앞뒤 공백은 무시한다', () => {
  assert.equal(matchesKeyPrefix('groq', '  gsk_xxx  '), true)
})

test('명세: 키 접두사가 공급자마다 다르다', () => {
  assert.deepEqual(getProviderSpec('gemini').keyPrefixes, ['AIza'])
  assert.deepEqual(getProviderSpec('claude').keyPrefixes, ['sk-ant-'])
  assert.deepEqual(getProviderSpec('groq').keyPrefixes, ['gsk_'])
  assert.deepEqual(getProviderSpec('grok').keyPrefixes, ['xai-'])
})

/* ── 여섯째를 더하면 파생이 전부 따라오는가 ────────────────── */

// 확장성의 유일한 판정: 명세 배열에 한 줄을 더했을 때
// 라벨·키맵·기본모델·순서 넷이 **손대지 않고** 여섯이 되는가.
const SIXTH: AiProviderSpec = {
  id: 'mistral' as AiProviderSpec['id'],
  label: 'Mistral',
  meta: { apiKey: 'mistral_api_key', model: 'mistral_model' },
  baseUrl: 'https://api.mistral.ai/v1',
  keyPrefixes: ['ms-'],
  defaultModel: 'mistral-large-latest',
  capabilities: { vision: false, tools: false, thinking: false, defaultMaxOutputTokens: 8192 },
  purpose: '유럽 공급자',
  keyIssueUrl: 'https://console.mistral.ai/api-keys',
}

test('확장: 명세에 하나 더하면 파생 목록 넷이 전부 여섯이 된다', () => {
  const specs = [...AI_PROVIDERS, SIXTH]

  assert.equal(Object.keys(deriveLabels(specs)).length, 6)
  assert.equal(deriveLabels(specs).mistral, 'Mistral')

  assert.equal(Object.keys(deriveMetaKeys(specs)).length, 6)
  assert.deepEqual(deriveMetaKeys(specs).mistral, { apiKey: 'mistral_api_key', model: 'mistral_model' })

  assert.equal(Object.keys(deriveDefaultModels(specs)).length, 6)
  assert.equal(deriveDefaultModels(specs).mistral, 'mistral-large-latest')

  assert.deepEqual(deriveOrder(specs).at(-1), 'mistral')
  assert.equal(deriveOrder(specs).length, 6)
})

test('확장: 파생 목록은 실제 명세와도 맞는다', () => {
  assert.deepEqual(deriveOrder(AI_PROVIDERS), AI_PROVIDER_IDS)
  assert.equal(Object.keys(deriveLabels(AI_PROVIDERS)).length, AI_PROVIDERS.length)
})

/* ── 명세 밖에 공급자 목록을 또 적은 곳이 없는가 ───────────── */

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/

// 이 파일들은 아직 명세를 안 쓴다. 항목 진행에 따라 비워지고, I14 가 이 목록이 비었는지 본다.
// 목록에 이름만 남고 실제 위반이 사라지면 그것도 실패다 — 목록이 화석이 되지 않게.
const KNOWN_PENDING = [
  'lib/ai-chat/registry.ts', // I02 에서 명세 파생으로 바뀜
  'app/(ai)/ai/actions.ts', // I02 — 화이트리스트를 isAiProviderId 로
  'app/api/admin/ai-chat/stream/route.ts', // I02 — 같음
  'lib/crm/ai/adapters/host.ts', // I02 — 같음
  'app/(ai)/ai/load.ts', // I13 에서 명세 파생으로 바뀜
]

const SCAN_DIRS = ['lib', 'app', 'components']
// 두 개 이상의 공급자 id 를 한 배열 리터럴에 나열한 곳 = 명세를 또 적은 곳
const ID_LIST_RE = /\[\s*'(?:gemini|claude|openai|groq|grok)'\s*,\s*'(?:gemini|claude|openai|groq|grok)'/

function walk(dir: string, acc: string[]) {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, acc); continue }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\.tsx?$/.test(name)) continue
    acc.push(full)
  }
}

function findIdListFiles(): string[] {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(APP_ROOT, d), files)
  const hits: string[] = []
  for (const f of files) {
    const rel = f.slice(APP_ROOT.length)
    if (rel === 'lib/ai/provider-catalog.ts') continue // 명세 본인
    if (ID_LIST_RE.test(readFileSync(f, 'utf8'))) hits.push(rel)
  }
  return hits.sort()
}

test('가드: 공급자 목록을 명세 밖에 또 적은 파일은 아직 남은 것뿐이다', () => {
  assert.deepEqual(findIdListFiles(), [...KNOWN_PENDING].sort())
})

test('가드: 스캔이 실제로 파일을 훑는다', () => {
  // 스캔이 조용히 0건이면 위 단정은 아무것도 안 지킨다(경로가 틀려도 통과한다)
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(APP_ROOT, d), files)
  assert.ok(files.length > 500, `훑은 파일 ${files.length}개 — 경로가 틀렸을 수 있다`)
})
