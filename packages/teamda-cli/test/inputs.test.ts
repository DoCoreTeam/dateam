/**
 * Input checks from the spec (instruction problems 3, 5-2, 7)
 *
 * The AI caller guessed parameter names from 400 messages and sent numbers as strings.
 * These tests pin: help shows each command's inputs, flags are typed by the schema,
 * an unknown name on a closed list is refused with candidates, and a missing required
 * input stops before the request, with and without --dry-run.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { fakeServer, runCli, tempDir, writeSyncedSpec, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_testkey_0123456789abcdef'
let server: FakeServer
let dir: string

const SPEC = {
  openapi: '3.1.0',
  servers: [{ url: '/api/public/v1' }],
  paths: {
    '/months': {
      get: {
        operationId: 't.month.get', summary: 'month', 'x-cli': 't month', 'x-scope': 'read', 'x-kind': 'route', 'x-query-complete': true,
        parameters: [
          { name: 'year', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'month', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'view', in: 'query', required: false, schema: { type: 'string', enum: ['day', 'week'] } },
        ],
      },
    },
    '/open': {
      get: { operationId: 't.open.get', summary: 'open', 'x-cli': 't open', 'x-scope': 'read', 'x-kind': 'route', 'x-query-complete': false, parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] },
    },
    '/quotes/{id}': {
      patch: {
        operationId: 't.quote.update', summary: 'update', 'x-cli': 't quote update', 'x-scope': 'write', 'x-kind': 'route', 'x-query-complete': true,
        parameters: [{ name: 'id', in: 'path', required: true }, { name: 'dryRun', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['version'],
          properties: { version: { type: 'number' }, title: { type: 'string' }, isActive: { type: 'boolean' }, amount: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } } },
        } } } },
      },
    },
    '/loose': {
      post: {
        operationId: 't.loose.create', summary: 'loose', 'x-cli': 't loose create', 'x-scope': 'write', 'x-kind': 'route',
        parameters: [{ name: 'dryRun', in: 'query' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', 'x-known-properties': { count: { type: 'integer' } } } } } },
      },
    },
    '/settings': {
      put: {
        operationId: 't.settings.set', summary: 'set', 'x-cli': 't settings set', 'x-scope': 'write', 'x-kind': 'route', 'x-query-complete': true,
        parameters: [{ name: 'dryRun', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['key'],
          properties: { key: { type: 'string' }, value: { type: 'string' } },
        } } } },
      },
    },
    '/actions/t/preview': {
      post: {
        operationId: 't.act.preview', summary: 'preview', 'x-cli': 't act preview', 'x-scope': 'read', 'x-kind': 'action', 'x-args': ['answers', 'overrides'],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', required: ['answers'],
          properties: { answers: { type: 'object' }, overrides: { type: 'object' }, args: { type: 'array' } },
        } } } },
      },
    },
  },
}

beforeAll(() => {
  server = fakeServer((_req, url) => Response.json({ success: true, data: { path: url.pathname } }))
  dir = tempDir()
  writeSyncedSpec(dir, SPEC)
})
afterAll(() => server.stop())

const env = () => ({ TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })
const err = (r: { stderr: string }) => JSON.parse(r.stderr).error

test('help <command> shows its query parameters with type and required', async () => {
  const r = await runCli(['help', 't', 'month'], env())
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('--year')
  expect(r.stdout).toMatch(/--year\s+integer\s+required/)
  expect(r.stdout).toMatch(/--view\s+day\|week\s+optional/)
})

test('help --json carries params and body for each command', async () => {
  const r = await runCli(['help', '--json'], env())
  const h = JSON.parse(r.stdout)
  const month = h.commands.find((c: { cli: string }) => c.cli === 't month')
  expect(month.params.map((p: { name: string }) => p.name)).toEqual(['year', 'month', 'view'])
  expect(month.paramsClosed).toBe(true)
  const upd = h.commands.find((c: { cli: string }) => c.cli === 't quote update')
  expect(upd.params[0]).toMatchObject({ name: 'id', in: 'path', required: true })
  expect(upd.body.closed).toBe(true)
  expect(upd.body.fields.find((f: { name: string }) => f.name === 'version')).toMatchObject({ type: 'number', required: true })
})

test('a number flag is sent as a number, booleans and lists by their type', async () => {
  const before = server.seen.length
  const r = await runCli(['t', 'quote', 'update', 'q1', '--version', '21', '--title', '21', '--isActive', 'false', '--amount', '1000', '--tags', 'a,b'], env())
  expect(r.code).toBe(0)
  const body = server.seen[before].body as Record<string, unknown>
  expect(body).toEqual({ version: 21, title: '21', isActive: false, amount: 1000, tags: ['a', 'b'] })
})

for (const dry of [false, true]) {
  const tail = dry ? ['--dry-run'] : []
  const label = dry ? ' (dry-run)' : ''

  test(`a non-number in a number flag stops before sending${label}`, async () => {
    const before = server.seen.length
    const r = await runCli(['t', 'quote', 'update', 'q1', '--version', 'abc', ...tail], env())
    expect(r.code).toBe(2)
    expect(err(r).code).toBe('invalid_flag_value')
    expect(err(r).message).toContain('--version')
    expect(server.seen.length).toBe(before)
  })

  test(`an unknown flag on a closed list is refused with candidates${label}`, async () => {
    const r = await runCli(['t', 'quote', 'update', 'q1', '--version', '1', '--titel', 'x', ...tail], env())
    expect(r.code).toBe(2)
    expect(err(r).code).toBe('unknown_flag')
    expect(err(r).message).toContain('did you mean --title')
  })

  test(`a missing required body field stops before sending${label}`, async () => {
    const r = await runCli(['t', 'quote', 'update', 'q1', '--title', 'x', ...tail], env())
    expect(r.code).toBe(2)
    expect(err(r).code).toBe('missing_param')
    expect(err(r).candidates).toEqual(['version'])
  })

  test(`a missing required server action argument stops before sending${label}`, async () => {
    const r = await runCli(['t', 'act', 'preview', ...tail], env())
    expect(r.code).toBe(2)
    expect(err(r).candidates).toEqual(['answers'])
  })
}

test('an unknown query flag on a read command is refused, not silently dropped', async () => {
  const before = server.seen.length
  const r = await runCli(['t', 'month', '--year', '2026', '--month', '10', '--q', 'x'], env())
  expect(r.code).toBe(2)
  expect(err(r).code).toBe('unknown_flag')
  expect(err(r).candidates).toContain('year')
  expect(server.seen.length).toBe(before)
})

test('a missing required query parameter and a bad integer stop before sending', async () => {
  const miss = await runCli(['t', 'month', '--year', '2026'], env())
  expect(miss.code).toBe(2)
  expect(err(miss).candidates).toEqual(['month'])
  const bad = await runCli(['t', 'month', '--year', 'x', '--month', '10'], env())
  expect(err(bad).message).toContain('--year must be an integer')
  const enumBad = await runCli(['t', 'month', '--year', '2026', '--month', '10', '--view', 'year'], env())
  expect(err(enumBad).candidates).toEqual(['day', 'week'])
})

test('a valid read sends the query as given', async () => {
  const before = server.seen.length
  const r = await runCli(['t', 'month', '--year', '2026', '--month', '10'], env())
  expect(r.code).toBe(0)
  expect(server.seen[before].url.search).toBe('?year=2026&month=10')
})

test('an open list passes names it does not know (the server may read them)', async () => {
  const q = await runCli(['t', 'open', '--other', '1'], env())
  expect(q.code).toBe(0)
  const before = server.seen.length
  const b = await runCli(['t', 'loose', 'create', '--count', '3', '--extra', 'y'], env())
  expect(b.code).toBe(0)
  expect(server.seen[before].body).toEqual({ count: 3, extra: 'y' })
})

test('a secret flag is still refused before any input check', async () => {
  const r = await runCli(['t', 'month', '--year', '2026', '--month', '10', '--token', 'x'], env())
  expect(r.code).toBe(2)
  expect(err(r).code).toBe('secret_on_argv')
})

// P0173: `ci settings set --key <setting name>` was refused as an API key on argv, so the
// four commands whose schema names a `key` field could not run at all
test('a command whose schema names a `key` field takes --key as that field', async () => {
  const before = server.seen.length
  const r = await runCli(['t', 'settings', 'set', '--key', 'theme', '--value', 'dark'], env())
  expect(r.code).toBe(0)
  expect(server.seen[before].body).toEqual({ key: 'theme', value: 'dark' })
})

test('a command without a `key` field still refuses --key, and so do built-ins', async () => {
  for (const argv of [['t', 'month', '--year', '2026', '--month', '10', '--key', 'x'], ['auth', 'login', '--key', 'x'], ['api', 'GET', 'x', '--key', 'x']]) {
    const r = await runCli(argv, env())
    expect(r.code).toBe(2)
    expect(err(r).code).toBe('secret_on_argv')
  }
})

test('a declared `key` field does not open other secret names on that command', async () => {
  const r = await runCli(['t', 'settings', 'set', '--key', 'theme', '--token', 'x'], env())
  expect(r.code).toBe(2)
  expect(err(r).code).toBe('secret_on_argv')
})
