import { test, expect, beforeAll, afterAll } from 'bun:test'
import { EXIT } from '../src/exit.ts'
import { VERSION } from '../src/context.ts'
import { fakeServer, runCli, tempDir, writeSyncedSpec, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_testkey_0123456789abcdef'
let server: FakeServer
let dir: string

const BODIES: Record<number, unknown> = {
  200: { success: true, data: { id: 'it_1', name: 'ok' } },
  202: { success: true, data: { approvalId: 'apr_42', requiredScope: 'approve' } },
  400: { success: false, error: 'bad input' },
  401: { success: false, error: 'no key' },
  403: { success: false, error: { code: 'scope_missing', message: 'needs approve', requiredScope: 'approve' } },
  404: { success: false, error: 'missing' },
  409: { success: false, error: 'version conflict' },
  422: { success: false, error: 'unprocessable' },
  405: { success: false, error: 'method' },
  503: { success: false, error: 'down' },
  429: { success: false, error: 'slow down' },
  500: { success: false, error: 'boom' },
}

beforeAll(() => {
  server = fakeServer((_req, url) => {
    const m = /\/items\/(\d{3})$/.exec(url.pathname)
    const status = m ? Number(m[1]) : 200
    return Response.json(BODIES[status] ?? { success: true, data: { path: url.pathname } }, { status })
  })
  dir = tempDir()
  writeSyncedSpec(dir)
})
afterAll(() => server.stop())

const env = () => ({ TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })

const CASES: [number, number, string][] = [
  [400, 2, 'bad_request'],
  [401, 3, 'unauthorized'],
  [403, 3, 'scope_missing'],
  [404, 4, 'not_found'],
  [409, 5, 'conflict'],
  [422, 2, 'unprocessable'],
  [429, 6, 'rate_limited'],
  [500, 8, 'server_error'],
  [503, 8, 'server_error'],
  [405, 2, 'http_405'],
]

test('200: exit 0 and exactly one JSON value on stdout', async () => {
  const r = await runCli(['t', 'item', 'get', '200'], env())
  expect(r.code).toBe(EXIT.OK)
  expect(r.stderr).toBe('')
  expect(r.stdout.trim().split('\n').length).toBe(1)
  expect(JSON.parse(r.stdout)).toEqual(BODIES[200] as object)
})

test('202: exit 7 with the approval id in the error envelope', async () => {
  const r = await runCli(['t', 'item', 'get', '202'], env())
  expect(r.code).toBe(7)
  expect(r.stdout).toBe('')
  const e = JSON.parse(r.stderr).error
  expect(e).toMatchObject({ code: 'approval_required', status: 202, approvalId: 'apr_42', requiredScope: 'approve' })
})

for (const [status, exit, code] of CASES) {
  test(`${status}: exit ${exit}, envelope code ${code}`, async () => {
    const r = await runCli(['t', 'item', 'get', String(status)], env())
    expect(r.code).toBe(exit)
    expect(r.stdout).toBe('')
    const e = JSON.parse(r.stderr).error
    expect(e.code).toBe(code)
    expect(e.status).toBe(status)
    expect(typeof e.message).toBe('string')
    if (status === 403) expect(e.requiredScope).toBe('approve')
  })
}

test('network failure: exit 1', async () => {
  const gone = fakeServer(() => new Response('x'))
  const base = gone.base
  gone.stop()
  const r = await runCli(['t', 'item', 'get', '200'], { ...env(), TEAMDA_BASE_URL: base })
  expect(r.code).toBe(1)
  expect(JSON.parse(r.stderr).error.code).toBe('network_error')
})

test('timeout: exit 1', async () => {
  const slow = fakeServer(async () => { await Bun.sleep(500); return Response.json({}) })
  const r = await runCli(['t', 'item', 'get', '200'], { ...env(), TEAMDA_BASE_URL: slow.base, TEAMDA_TIMEOUT_MS: '50' })
  slow.stop()
  expect(r.code).toBe(1)
  expect(JSON.parse(r.stderr).error.code).toBe('timeout')
})

test('no key: exit 3 before any request', async () => {
  const before = server.seen.length
  const r = await runCli(['t', 'item', 'get', '200'], { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base })
  expect(r.code).toBe(EXIT.AUTH)
  expect(JSON.parse(r.stderr).error.code).toBe('auth_missing')
  expect(server.seen.length).toBe(before)
})

test('usage errors: unknown command and missing path param exit 2', async () => {
  expect((await runCli(['t', 'nope', 'x'], env())).code).toBe(2)
  expect((await runCli(['t', 'item', 'get'], env())).code).toBe(2)
})

test('exit table matches directive ins_0318 5-3', () => {
  expect(EXIT).toEqual({
    OK: 0, UNKNOWN: 1, USAGE: 2, AUTH: 3, NOT_FOUND: 4, CONFLICT: 5,
    RATE_LIMITED: 6, APPROVAL_REQUIRED: 7, SERVER: 8, MISMATCH: 9,
  })
})

test('headers, dry-run, idempotency key, and body', async () => {
  const r = await runCli(['t', 'item', 'create', '--name', 'A', '--json', '{"qty":2}', '--dry-run', '--idempotency-key', 'idem-1'], env())
  expect(r.code).toBe(0)
  const s = server.seen.at(-1)!
  expect(s.method).toBe('POST')
  expect(s.url.pathname).toBe('/api/public/v1/items')
  expect(s.url.searchParams.get('dryRun')).toBe('1')
  expect(s.body).toEqual({ qty: 2, name: 'A' })
  expect(s.headers.get('x-api-key')).toBe(KEY)
  expect(s.headers.get('idempotency-key')).toBe('idem-1')
  expect(s.headers.get('x-agent')).toBe(`teamda/${VERSION}`)
  expect(s.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
})

test('server action: named flags plus positional args', async () => {
  const r = await runCli(['t', 'act', 'run', '--note', 'hi', 'extra1'], env())
  expect(r.code).toBe(0)
  const s = server.seen.at(-1)!
  expect(s.url.pathname).toBe('/api/public/v1/actions/t/run')
  expect(s.body).toEqual({ note: 'hi', args: ['extra1'] })
})

test('api escape hatch: raw method and path', async () => {
  const r = await runCli(['api', 'GET', 'items/200', '--limit', '5'], env())
  expect(r.code).toBe(0)
  const s = server.seen.at(-1)!
  expect(s.url.pathname).toBe('/api/public/v1/items/200')
  expect(s.url.searchParams.get('limit')).toBe('5')
  const bad = await runCli(['api', 'GET', 'https://evil.example/x'], env())
  expect(bad.code).toBe(EXIT.USAGE)
  const notFound = await runCli(['api', 'DELETE', '/api/public/v1/items/404'], env())
  expect(notFound.code).toBe(EXIT.NOT_FOUND)
})
