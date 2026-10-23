import { test, expect, beforeAll } from 'bun:test'
import { EXIT } from '../src/exit.ts'
import { DEFAULT_RETRY_WAIT_MS, MAX_RETRY_WAIT_MS, retryAfterMs } from '../src/http.ts'
import { fakeServer, runCli, tempDir, writeSyncedSpec, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_testkey_0123456789abcdef'
let dir: string

beforeAll(() => {
  dir = tempDir()
  writeSyncedSpec(dir)
})

/** A server that answers with the given statuses in order, then repeats the last one. */
function scripted(statuses: number[], headers: Record<string, string> = {}): FakeServer {
  let i = 0
  return fakeServer(() => {
    const status = statuses[Math.min(i++, statuses.length - 1)]
    const body = status < 300 ? { success: true, data: { id: 'it_1' } } : { success: false, error: `status ${status}` }
    return Response.json(body, { status, headers: status === 429 ? headers : {} })
  })
}

async function create(s: FakeServer, extra: string[] = []) {
  try {
    return await runCli(['t', 'item', 'create', '--name', 'A', ...extra],
      { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: s.base, TEAMDA_API_KEY: KEY })
  } finally {
    s.stop()
  }
}

test('429 twice then 200: exit 0 after 3 requests, same Idempotency-Key and body', async () => {
  const s = scripted([429, 429, 200], { 'Retry-After': '2' })
  const r = await create(s)
  expect(r.code).toBe(EXIT.OK)
  expect(s.seen.length).toBe(3)
  const keys = s.seen.map((x) => x.headers.get('idempotency-key'))
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(new Set(keys).size).toBe(1)
  for (const x of s.seen) expect(x.body).toEqual({ name: 'A' })
  expect(r.sleeps).toEqual([2000, 2000])
})

test('given --idempotency-key is reused on every retry', async () => {
  const s = scripted([429, 200])
  const r = await create(s, ['--idempotency-key', 'idem-7'])
  expect(r.code).toBe(EXIT.OK)
  expect(s.seen.map((x) => x.headers.get('idempotency-key'))).toEqual(['idem-7', 'idem-7'])
})

test('429 always: exit 6 after 4 requests (3 retries)', async () => {
  const s = scripted([429])
  const r = await create(s)
  expect(r.code).toBe(EXIT.RATE_LIMITED)
  expect(s.seen.length).toBe(4)
  expect(JSON.parse(r.stderr).error.code).toBe('rate_limited')
  expect(r.sleeps).toEqual([DEFAULT_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS])
})

test('Retry-After larger than the cap waits the cap', async () => {
  const s = scripted([429, 200], { 'Retry-After': '3600' })
  const r = await create(s)
  expect(r.code).toBe(EXIT.OK)
  expect(r.sleeps).toEqual([MAX_RETRY_WAIT_MS])
})

test('Retry-After parsing: seconds, HTTP-date, missing, invalid, past', () => {
  const now = Date.parse('2026-10-23T00:00:00Z')
  expect(retryAfterMs('5', now)).toBe(5000)
  expect(retryAfterMs('0', now)).toBe(0)
  expect(retryAfterMs(new Date(now + 7000).toUTCString(), now)).toBe(7000)
  expect(retryAfterMs(new Date(now - 7000).toUTCString(), now)).toBe(0)
  expect(retryAfterMs(null, now)).toBe(DEFAULT_RETRY_WAIT_MS)
  expect(retryAfterMs('soon', now)).toBe(DEFAULT_RETRY_WAIT_MS)
  expect(retryAfterMs('-3', now)).toBe(DEFAULT_RETRY_WAIT_MS)
  expect(retryAfterMs('999999', now)).toBe(MAX_RETRY_WAIT_MS)
})

test('500 then 200: exit 0 after 2 requests, same Idempotency-Key', async () => {
  const s = scripted([500, 200])
  const r = await create(s)
  expect(r.code).toBe(EXIT.OK)
  expect(s.seen.length).toBe(2)
  expect(s.seen[0].headers.get('idempotency-key')).toBe(s.seen[1].headers.get('idempotency-key'))
  expect(r.sleeps).toEqual([DEFAULT_RETRY_WAIT_MS])
})

test('500 always: exit 8 after 2 requests (1 retry)', async () => {
  const s = scripted([503])
  const r = await create(s)
  expect(r.code).toBe(EXIT.SERVER)
  expect(s.seen.length).toBe(2)
})

for (const status of [400, 202, 409]) {
  test(`${status}: no retry`, async () => {
    const s = scripted([status, 200])
    const r = await create(s)
    expect(r.code).not.toBe(EXIT.OK)
    expect(s.seen.length).toBe(1)
    expect(r.sleeps).toEqual([])
  })
}

test('GET gets no generated Idempotency-Key', async () => {
  const s = scripted([200])
  try {
    await runCli(['t', 'item', 'get', '1'], { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: s.base, TEAMDA_API_KEY: KEY })
  } finally {
    s.stop()
  }
  expect(s.seen[0].headers.get('idempotency-key')).toBeNull()
})
