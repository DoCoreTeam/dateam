/**
 * 등록한 키를 **실제로 전부 쓰는가** (실행으로 잰다)
 *
 * ## 왜 소스 스캔이 아니라 실행인가
 *
 * 2026-09-21 사고의 모양이 「배선은 있는데 안 탄다」였다. `key-rotation` 도 `key-pool` 도
 * 다 있었고 시험도 초록이었는데, 정작 CRM 추출은 `getProvider(...).streamChat` 을 직접 불러
 * META 의 키 한 개로 끝냈다. 표에 든 키 여섯 줄의 `last_used_at` 이 전부 비어 있었다.
 *
 * 그래서 여기서는 가짜 공급자를 끼우고 **어느 키로 몇 번 불렀는지**를 센다.
 * 이름이 아니라 값이 가는지를 봐야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { streamChatWithKeys } from './stream-with-keys.ts'
import { orderKeys, type KeyPoolEntry } from '../ai/key-pool.ts'
import type { ChatProvider, ProviderId, StreamChatParams, StreamChatResult } from './provider.ts'

/* ── 준비물 ─────────────────────────────────────── */

function entry(over: Partial<KeyPoolEntry> & { id: string; apiKey: string }): KeyPoolEntry {
  return {
    provider: 'gemini',
    label: over.id,
    priority: 0,
    isPaid: false,
    isActive: true,
    cooldownUntil: null,
    disabledReason: null,
    consecutiveFailures: 0,
    ...over,
  }
}

const OK: StreamChatResult = {
  text: '답',
  thinking: null,
  usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
  stopped: false,
}

/** 부른 키를 순서대로 적어 두는 가짜 공급자. `fail` 이 정한 키에서만 던진다 */
function fakeProvider(fail: (apiKey: string) => Error | null) {
  const calls: string[] = []
  const get = ((_id: ProviderId) => ({
    id: 'gemini' as ProviderId,
    label: 'Gemini',
    capabilities: { vision: true, tools: true, thinking: false, defaultMaxOutputTokens: 8192 },
    async streamChat(p: StreamChatParams): Promise<StreamChatResult> {
      calls.push(p.apiKey)
      const e = fail(p.apiKey)
      if (e) throw e
      return OK
    },
    async listModels() { return [] },
  } as unknown as ChatProvider)) as never
  return { calls, get }
}

const PARAMS = {
  model: 'gemini-3-flash-preview',
  turns: [{ role: 'user' as const, content: '읽어 줘' }],
  actorId: null,
  signal: AbortSignal.timeout(5_000),
  onDelta: () => {},
}

const quota = () => new Error('429 Too Many Requests: You exceeded your current quota')

/* ── 키를 갈아 가며 부르는가 ─────────────────────── */

test('★ 첫 키가 429 면 같은 공급자 다음 키로 다시 부른다 — 이번 사고의 정확한 반대', async () => {
  const entries = [entry({ id: 'k1', apiKey: 'A' }), entry({ id: 'k2', apiKey: 'B' })]
  const fake = fakeProvider((key) => (key === 'A' ? quota() : null))

  const out = await streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries, record: () => {} },
    getProvider: fake.get,
  })

  assert.equal(out.text, '답')
  assert.deepEqual(fake.calls, ['A', 'B'], '두 번째 키를 안 불렀다 — 등록해 둔 키가 놀고 있다')
})

test('★ 무료 키가 다 마른 뒤에야 유료 키를 부른다 — 순서가 뒤집히면 요금이 먼저 나간다', async () => {
  const entries = orderKeys([
    entry({ id: 'paid', apiKey: 'P', isPaid: true, priority: 3 }),
    entry({ id: 'free1', apiKey: 'A', priority: 0 }),
    entry({ id: 'free2', apiKey: 'B', priority: 1 }),
  ], Date.now())
  const fake = fakeProvider((key) => (key === 'P' ? null : quota()))

  const out = await streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries, record: () => {} },
    getProvider: fake.get,
  })

  assert.equal(out.text, '답')
  assert.deepEqual(fake.calls, ['A', 'B', 'P'],
    '유료 키가 앞서 불렸거나 아예 안 불렸다 — 사용자가 넣어 둔 유료 키가 노는 것이 이번 사고다')
})

test('★ 키가 하나면 정확히 한 번 부른다 — 교체가 헛호출을 늘리지 않는다', async () => {
  const fake = fakeProvider(() => null)
  await streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries: [entry({ id: 'k1', apiKey: 'A' })], record: () => {} },
    getProvider: fake.get,
  })
  assert.deepEqual(fake.calls, ['A'])
})

test('키를 다 써도 안 되면 마지막 오류를 그대로 올린다 — 우리 말로 바꾸지 않는다', async () => {
  const entries = [entry({ id: 'k1', apiKey: 'A' }), entry({ id: 'k2', apiKey: 'B' })]
  const fake = fakeProvider(() => quota())

  await assert.rejects(
    () => streamChatWithKeys('gemini', 'A', PARAMS, {
      keys: { entries, record: () => {} },
      getProvider: fake.get,
    }),
    /429/,
  )
  assert.deepEqual(fake.calls, ['A', 'B'])
})

test('네트워크가 한 번 튄 것으로는 키를 안 태운다 — 정작 한도가 찼을 때 쓸 키가 없어진다', async () => {
  const entries = [entry({ id: 'k1', apiKey: 'A' }), entry({ id: 'k2', apiKey: 'B' })]
  const fake = fakeProvider(() => new Error('socket hang up'))

  await assert.rejects(() => streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries, record: () => {} },
    getProvider: fake.get,
  }))
  assert.deepEqual(fake.calls, ['A'], '원인 불명 실패에 남은 키를 태웠다')
})

/* ── 갈아탄 사실과 비밀 ──────────────────────────── */

test('★ 갈아타면 말한다, 그리고 키 이름만 준다 — 원문이 화면이나 로그로 나가면 안 된다', async () => {
  const entries = [
    entry({ id: 'k1', apiKey: 'fake-key-one', label: '기본' }),
    entry({ id: 'k2', apiKey: 'fake-key-two', label: '유료키' }),
  ]
  const fake = fakeProvider((key) => (key === 'fake-key-one' ? quota() : null))
  const said: string[] = []

  await streamChatWithKeys('gemini', 'fake-key-one', PARAMS, {
    keys: {
      entries,
      record: () => {},
      onSwitch: (from, to) => { said.push(`${from.label} → ${to.label}`) },
    },
    getProvider: fake.get,
  })

  assert.deepEqual(said, ['기본 → 유료키'], '갈아탄 사실을 조용히 넘겼다')
})

test('마지막 키가 실패할 때는 갈아탄다고 말하지 않는다 — 갈 곳이 없는데 간다고 하면 안 된다', async () => {
  const entries = [entry({ id: 'k1', apiKey: 'A' }), entry({ id: 'k2', apiKey: 'B' })]
  const fake = fakeProvider(() => quota())
  const said: string[] = []

  await assert.rejects(() => streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries, record: () => {}, onSwitch: () => { said.push('x') } },
    getProvider: fake.get,
  }))
  assert.equal(said.length, 1, '키 둘이면 교체 안내는 한 번뿐이다')
})

/* ── 결말이 표에 적히는가 ────────────────────────── */

test('★ 한 번 부를 때마다 결말을 적는다 — 안 적으면 화면이 마른 키를 「쓸 수 있음」으로 보인다', async () => {
  const entries = [entry({ id: 'k1', apiKey: 'A' }), entry({ id: 'k2', apiKey: 'B' })]
  const fake = fakeProvider((key) => (key === 'A' ? quota() : null))
  const noted: string[] = []

  await streamChatWithKeys('gemini', 'A', PARAMS, {
    keys: { entries, record: (e, outcome) => { noted.push(`${e.label}:${outcome}`) } },
    getProvider: fake.get,
  })

  assert.deepEqual(noted, ['k1:quota', 'k2:ok'])
})
