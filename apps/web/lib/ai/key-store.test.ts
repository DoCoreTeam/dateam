// lib/ai/key-store.test.ts — 저장소가 고장 나도 AI 가 멈추지 않는가
//
// 이 모듈의 실패는 **조용하다.** 표를 못 읽으면 「키가 없다」로 보이고, 상태를 못 적으면
// 마른 키를 계속 두드린다. 둘 다 화면에서는 그냥 「AI 가 안 된다」다.
// 그래서 정상 경로보다 **망가진 경로**를 더 많이 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readKeyPoolWith,
  recordKeyOutcomeWith,
  rowToEntry,
  metaEntry,
  metaApiKey,
  isMetaEntry,
  redactSecrets,
  type KeyRow,
  type KeyStoreGateway,
} from './key-store-core.ts'
import { QUOTA_COOLDOWN_MS, type KeyStatePatch } from './key-pool.ts'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')
const RAW_KEY = 'AIzaSyD-1234567890abcdefghij'

function row(over: Partial<KeyRow> & { id: string }): KeyRow {
  return {
    provider: 'gemini',
    label: over.id,
    api_key: `${RAW_KEY}-${over.id}`,
    priority: 0,
    is_active: true,
    cooldown_until: null,
    disabled_reason: null,
    consecutive_failures: 0,
    ...over,
  }
}

/** 표도 META 도 마음대로 고장 낼 수 있는 창구 */
function gatewayOf(over: Partial<KeyStoreGateway> = {}): KeyStoreGateway {
  return {
    readRows: async () => [],
    readMeta: async () => ({}),
    writeState: async () => {},
    ...over,
  }
}

/** console.error 를 가로채 무엇이 찍혔는지 본다 */
async function capturingConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    const result = await fn()
    return { result, logged: lines.join('\n') }
  } finally {
    console.error = original
  }
}

/* ── 정상 경로 ─────────────────────────────────────────────── */

test('표에 줄이 있으면 우선순위 순서로 돌려준다', async () => {
  const gateway = gatewayOf({
    readRows: async () => [row({ id: 'b', priority: 2 }), row({ id: 'a', priority: 0 })],
  })

  const got = await readKeyPoolWith(gateway, 'gemini', NOW)

  assert.deepEqual(got.map((k) => k.id), ['a', 'b'])
})

test('쉬는 키는 빠진다 — 순서 판단은 key-pool 한 곳에서만 한다', async () => {
  const gateway = gatewayOf({
    readRows: async () => [
      row({ id: 'cooling', priority: 0, cooldown_until: new Date(NOW + 60_000).toISOString(), disabled_reason: 'quota' }),
      row({ id: 'ready', priority: 1 }),
    ],
  })

  assert.deepEqual((await readKeyPoolWith(gateway, 'gemini', NOW)).map((k) => k.id), ['ready'])
})

test('돌려준 줄에는 원문 키가 그대로 있다 — 이걸로 공급자를 부른다', async () => {
  const gateway = gatewayOf({ readRows: async () => [row({ id: 'a' })] })

  const [first] = await readKeyPoolWith(gateway, 'gemini', NOW)

  assert.equal(first.apiKey, `${RAW_KEY}-a`)
})

/* ── 표가 없거나 못 읽을 때 ────────────────────────────────── */

test('표가 비면 META 의 기존 키 하나로 떨어진다 — 마이그레이션 전에도 지금처럼 돈다', async () => {
  const gateway = gatewayOf({
    readRows: async () => [],
    readMeta: async () => ({ gemini_api_key: RAW_KEY }),
  })

  const got = await readKeyPoolWith(gateway, 'gemini', NOW)

  assert.equal(got.length, 1)
  assert.equal(got[0].apiKey, RAW_KEY)
  assert.ok(isMetaEntry(got[0]), '표에 없는 줄이라는 것이 값에 드러나야 한다')
})

test('★ 표를 못 읽어도 예외가 위로 안 올라간다 — 저장소 때문에 AI 가 멈추면 안 된다', async () => {
  const gateway = gatewayOf({
    readRows: async () => { throw new Error('permission denied for table ai_provider_keys') },
    readMeta: async () => ({ gemini_api_key: RAW_KEY }),
  })

  const { result } = await capturingConsole(() => readKeyPoolWith(gateway, 'gemini', NOW))

  assert.equal(result.length, 1, '읽기가 깨져도 META 로 이어 간다')
  assert.equal(result[0].apiKey, RAW_KEY)
})

test('META 도 못 읽으면 빈 목록이다 — 예외 대신 「키가 없다」로 말한다', async () => {
  const gateway = gatewayOf({
    readRows: async () => { throw new Error('boom') },
    readMeta: async () => { throw new Error('boom') },
  })

  const { result } = await capturingConsole(() => readKeyPoolWith(gateway, 'gemini', NOW))

  assert.deepEqual(result, [])
})

test('META 칸이 비어 있으면 가짜 줄을 만들지 않는다', async () => {
  const gateway = gatewayOf({ readMeta: async () => ({ gemini_api_key: '   ' }) })

  assert.deepEqual(await readKeyPoolWith(gateway, 'gemini', NOW), [])
})

test('공급자마다 자기 META 칸을 본다 — Groq 키 자리는 stt_api_key 다', () => {
  const meta = { gemini_api_key: 'g', stt_api_key: 's', xai_api_key: 'x' }

  assert.equal(metaApiKey(meta, 'gemini'), 'g')
  assert.equal(metaApiKey(meta, 'groq'), 's', '이름을 groq_api_key 로 바꾸면 이미 저장된 키를 못 찾는다')
  assert.equal(metaApiKey(meta, 'grok'), 'x')
  assert.equal(metaApiKey(meta, 'claude'), null)
})

/* ── 상태 기록 ─────────────────────────────────────────────── */

test('429 는 쿨다운으로 적힌다', async () => {
  let written: { id: string; patch: KeyStatePatch } | null = null
  const gateway = gatewayOf({ writeState: async (id, patch) => { written = { id, patch } } })

  await recordKeyOutcomeWith(gateway, rowToEntry(row({ id: 'a' }), 'gemini'), 'quota', NOW, '429')

  assert.ok(written)
  assert.equal(written!.id, 'a')
  assert.equal(Date.parse(written!.patch.cooldownUntil!), NOW + QUOTA_COOLDOWN_MS)
  assert.equal(written!.patch.disabledReason, 'quota')
})

test('★ 상태를 못 적어도 호출은 그대로 끝난다 — 기록은 다음 호출을 낫게 할 뿐이다', async () => {
  const gateway = gatewayOf({ writeState: async () => { throw new Error('update failed') } })

  const { logged } = await capturingConsole(() =>
    recordKeyOutcomeWith(gateway, rowToEntry(row({ id: 'a' }), 'gemini'), 'quota', NOW))

  assert.match(logged, /상태 기록 실패/, '조용히 삼키지도 않는다')
})

test('META 로 떨어진 줄은 표에 적으려 들지 않는다 — 없는 id 로 0행을 고치면 적힌 줄 안다', async () => {
  let called = false
  const gateway = gatewayOf({ writeState: async () => { called = true } })

  await recordKeyOutcomeWith(gateway, metaEntry('gemini', RAW_KEY), 'quota', NOW)

  assert.equal(called, false)
})

/* ── 원문 키가 새지 않는가 ─────────────────────────────────── */

test('★ 표를 못 읽었을 때의 로그에 키 원문이 없다', async () => {
  const gateway = gatewayOf({
    readRows: async () => { throw new Error(`invalid key ${RAW_KEY}`) },
    readMeta: async () => ({ gemini_api_key: RAW_KEY }),
  })

  const { logged } = await capturingConsole(() => readKeyPoolWith(gateway, 'gemini', NOW))

  // 공급자 원문에 키 조각이 섞여 오는 일이 실제로 있다. 그 문자열을 그대로 찍지 않는다
  assert.ok(logged.length > 0, '실패를 조용히 넘기지도 않는다')
  assert.ok(!logged.includes(RAW_KEY), `로그에 키 원문이 실렸다: ${logged}`)
})

test('★ 상태 기록 실패 로그에도 키 원문이 없다 — 가림값과 이름만', async () => {
  const gateway = gatewayOf({ writeState: async () => { throw new Error('boom') } })
  const entry = rowToEntry(row({ id: 'a', api_key: RAW_KEY, label: '두번째' }), 'gemini')

  const { logged } = await capturingConsole(() =>
    recordKeyOutcomeWith(gateway, entry, 'auth', NOW, RAW_KEY))

  assert.ok(!logged.includes(RAW_KEY), `로그에 키 원문이 실렸다: ${logged}`)
  assert.match(logged, /두번째/, '어느 키인지는 이름으로 말한다')
  assert.match(logged, /AIza\*{4}ghij/, '가림값이 있어야 어느 키인지 대조할 수 있다')
})

test('★ 표에 남는 오류 문구에도 키 원문이 없다 — last_error 는 관리자 화면에 그대로 뜬다', async () => {
  let written: KeyStatePatch | null = null
  const gateway = gatewayOf({ writeState: async (_id, patch) => { written = patch } })

  await recordKeyOutcomeWith(gateway, rowToEntry(row({ id: 'a' }), 'gemini'), 'auth', NOW,
    `401 invalid api key ${RAW_KEY}`)

  assert.ok(written)
  assert.ok(!written!.lastError!.includes(RAW_KEY), `표에 키 원문이 적혔다: ${written!.lastError}`)
  assert.match(written!.lastError!, /401 invalid api key/, '무슨 일이었는지는 남아야 한다')
})

test('가림은 키 모양 토막에만 걸린다 — 사람이 읽을 말은 그대로 남는다', () => {
  assert.equal(redactSecrets('permission denied for table ai_provider_keys'),
    'permission denied for table ai_provider_keys')
  assert.equal(redactSecrets('429 Too Many Requests'), '429 Too Many Requests')
})

/* ── 원문 키가 이 모듈 밖으로 흩어지지 않는가 ──────────────── */

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')
const STORE = readFileSync(join(HERE, 'key-store.ts'), 'utf8')

test('key-store.ts 첫 줄이 import \'server-only\' 다', () => {
  assert.equal(STORE.split('\n')[0].trim(), "import 'server-only'",
    '클라이언트 번들에 끌려 들어가면 원문 키가 브라우저로 나간다')
})

test('서비스롤 클라이언트를 만드는 자리가 이 모듈 안에만 있다', () => {
  assert.match(STORE, /createAdminClient/)
  const core = readFileSync(join(HERE, 'key-store-core.ts'), 'utf8')
  assert.ok(!core.includes('createAdminClient'), 'core 는 DB 를 몰라야 시험할 수 있다')
})

/** lib 과 app 을 훑어 ai_provider_keys 를 직접 만지는 자리를 센다 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.next-')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

test('★ ai_provider_keys 를 직접 읽고 쓰는 자리는 key-store.ts 하나뿐이다', () => {
  const offenders = [...sourceFiles(join(WEB, 'lib')), ...sourceFiles(join(WEB, 'app'))]
    .filter((f) => !f.endsWith(join('lib', 'ai', 'key-store.ts')))
    .filter((f) => /from\(['"]ai_provider_keys['"]\)/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(WEB.length + 1))

  assert.deepEqual(offenders, [],
    '원문 키가 든 표를 여러 자리에서 열면 어디가 응답에 싣는지 셀 수 없다')
})
