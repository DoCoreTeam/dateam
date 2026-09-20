// lib/ai/key-rotation.test.ts — 막힌 키를 정말 건너뛰는가, 그리고 **안 막힌 키를 태우지 않는가**
//
// 두 방향으로 틀릴 수 있고 둘 다 조용하다.
//   덜 넘어가면: 키를 여러 개 넣어 뒀는데 첫 키가 마른 날 기능이 그냥 멈춘다
//   더 넘어가면: 네트워크가 한 번 튄 것으로 키를 하나씩 소진하고, 정작 한도가 찼을 때 남은 것이 없다
// 그래서 「몇 번 불렀나」를 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withProviderKeys, keyOutcomeOf } from './key-rotation.ts'
import type { KeyPoolEntry, KeyOutcome } from './key-pool.ts'

function keyEntry(label: string, apiKey: string): KeyPoolEntry {
  return {
    id: label, provider: 'gemini', label, apiKey,
    priority: 0, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
  }
}

const QUOTA = () => new Error('429 RESOURCE_EXHAUSTED: quota exceeded')
const AUTH = () => new Error('401 Unauthorized: API key not valid')
const NETWORK = () => new Error('fetch failed: ECONNRESET')

/* ── 무엇을 키 문제로 보는가 ───────────────────────────────── */

test('한도와 인증만 키 문제다 — 분류는 provider-errors 한 곳에서 온다', () => {
  assert.equal(keyOutcomeOf(QUOTA()), 'quota')
  assert.equal(keyOutcomeOf(AUTH()), 'auth')
  assert.equal(keyOutcomeOf(NETWORK()), 'transient')
  assert.equal(keyOutcomeOf(new Error('404 model not found')), 'transient',
    '모델이 없어진 것은 키를 바꿔도 같다')
})

/* ── 넘어가는가 ────────────────────────────────────────────── */

test('★ 한도에 걸린 키를 건너뛰고 다음 키로 같은 일을 다시 한다', async () => {
  const used: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  const got = await withProviderKeys('gemini', 'k1', async (apiKey) => {
    used.push(apiKey)
    if (apiKey === 'k1') throw QUOTA()
    return '됐다'
  }, { entries })

  assert.equal(got, '됐다')
  assert.deepEqual(used, ['k1', 'k2'])
})

test('★ 인증이 깨진 키도 건너뛴다 — 기다려서 풀릴 일이 아니다', async () => {
  const used: string[] = []
  const entries = [keyEntry('깨진것', 'k1'), keyEntry('멀쩡한것', 'k2')]

  await withProviderKeys('gemini', 'k1', async (apiKey) => {
    used.push(apiKey)
    if (apiKey === 'k1') throw AUTH()
    return 1
  }, { entries })

  assert.deepEqual(used, ['k1', 'k2'])
})

/* ── 안 넘어가는가 ─────────────────────────────────────────── */

test('★ 네트워크 오류로는 키를 태우지 않는다 — 한도가 찼을 때 쓸 것이 남아야 한다', async () => {
  const used: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await assert.rejects(
    () => withProviderKeys('gemini', 'k1', async (apiKey) => {
      used.push(apiKey)
      throw NETWORK()
    }, { entries }),
    /ECONNRESET/,
  )
  assert.deepEqual(used, ['k1'], '키를 바꿔도 같은 답이 올 실패에 키를 하나 더 썼다')
})

test('★ 키가 하나면 정확히 한 번 부른다 — 교체가 헛호출을 늘리지 않는다', async () => {
  let n = 0

  await withProviderKeys('gemini', 'k1', async () => { n += 1; return 'ok' },
    { entries: [keyEntry('하나', 'k1')] })

  assert.equal(n, 1)
})

test('키를 다 써도 안 되면 마지막 오류를 그대로 올린다 — 원인을 우리 말로 바꾸지 않는다', async () => {
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await assert.rejects(
    () => withProviderKeys('gemini', 'k1', async () => { throw QUOTA() }, { entries }),
    /RESOURCE_EXHAUSTED/,
  )
})

/* ── 부르는 쪽이 준 키가 먼저다 ────────────────────────────── */

test('부르는 쪽이 지목한 키를 표가 덮지 않는다 — 「이 키로 시험」이 엉뚱한 키를 두드리면 안 된다', async () => {
  const used: string[] = []
  const entries = [keyEntry('표첫째', 'table1'), keyEntry('표둘째', 'table2')]

  await withProviderKeys('gemini', 'mine', async (apiKey) => { used.push(apiKey); return 1 }, { entries })

  assert.deepEqual(used, ['mine'])
})

test('같은 키가 표에도 있으면 표의 줄로 적는다 — 그래야 상태가 그 줄에 쌓인다', async () => {
  const seen: string[] = []
  const entries = [keyEntry('표에있는이름', 'k1')]

  await withProviderKeys('gemini', 'k1', async () => 1,
    { entries, record: async (entry) => { seen.push(entry.label) } })

  assert.deepEqual(seen, ['표에있는이름'])
})

/* ── 기록 ──────────────────────────────────────────────────── */

test('결말이 그대로 넘어간다 — 한도는 quota, 성공은 ok', async () => {
  const seen: { label: string; outcome: KeyOutcome }[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await withProviderKeys('gemini', 'k1', async (apiKey) => {
    if (apiKey === 'k1') throw QUOTA()
    return 1
  }, { entries, record: async (entry, outcome) => { seen.push({ label: entry.label, outcome }) } })

  assert.deepEqual(seen, [{ label: '첫째', outcome: 'quota' }, { label: '둘째', outcome: 'ok' }])
})

test('★ 기록이 실패해도 호출은 그대로 끝난다', async () => {
  const got = await withProviderKeys('gemini', 'k1', async () => '됐다', {
    entries: [keyEntry('하나', 'k1')],
    record: async () => { throw new Error('표가 없다') },
  })

  assert.equal(got, '됐다')
})

test('★ 표를 못 읽어도 부르는 쪽이 준 키 하나로 돈다 — 저장소가 기능을 멈추지 않는다', async () => {
  // entries 를 안 주면 key-store 를 부르는데, 시험에서는 server-only 라 불러지지 않는다.
  // 그 경로가 조용히 한 개짜리 목록으로 떨어지는지를 여기서 센다.
  const used: string[] = []

  const got = await withProviderKeys('gemini', 'only-key', async (apiKey) => { used.push(apiKey); return 'ok' })

  assert.equal(got, 'ok')
  assert.deepEqual(used, ['only-key'])
})
