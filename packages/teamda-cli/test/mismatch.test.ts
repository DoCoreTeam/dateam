import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { EXIT } from '../src/exit.ts'
import { compareSaved, savedRecord, sameValue } from '../src/mismatch.ts'
import { fakeServer, runCli, tempDir, writeSyncedSpec, TEST_SPEC, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_testkey_0123456789abcdef'
let server: FakeServer
let dir: string
/** What the fake server answers with next, as a function of the body it got. */
let reply: (body: Record<string, unknown>) => unknown = (b) => ({ success: true, data: b })

const SPEC = {
  ...TEST_SPEC,
  paths: {
    ...TEST_SPEC.paths,
    '/things/{id}': {
      patch: {
        operationId: 't.thing.update', summary: 'update thing', 'x-cli': 't thing update', 'x-scope': 'write', 'x-kind': 'route',
        parameters: [{ name: 'id', in: 'path', required: true }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
  },
}

beforeAll(() => {
  server = fakeServer(async (req) => {
    const text = await req.text()
    return Response.json(reply(text ? JSON.parse(text) : {}), { status: 200 })
  })
  dir = tempDir()
  writeSyncedSpec(dir, SPEC)
})
afterAll(() => server.stop())

const env = () => ({ TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })
const create = (body: object, ...extra: string[]) => runCli(['t', 'item', 'create', '--json', JSON.stringify(body), ...extra], env())

describe('CLI exit 9', () => {
  test('saved equals sent: exit 0, nothing on stderr', async () => {
    reply = (b) => ({ success: true, data: { id: 'it_1', ...b } })
    const r = await create({ name: 'A', qty: 2 })
    expect(r.code).toBe(EXIT.OK)
    expect(r.stderr).toBe('')
  })

  test('saved differs: stdout keeps the response, stderr lists the field, exit 9', async () => {
    reply = (b) => ({ success: true, data: { id: 'it_1', ...b, qty: 3 } })
    const r = await create({ name: 'A', qty: 2 })
    expect(r.code).toBe(EXIT.MISMATCH)
    expect(JSON.parse(r.stdout).data.qty).toBe(3)
    const e = JSON.parse(r.stderr).error
    expect(e.code).toBe('mismatch')
    expect(e.mismatch).toEqual([{ field: 'qty', sent: 2, saved: 3 }])
  })

  test('PATCH with a wrapped record ({ data: { item } }) is checked too', async () => {
    reply = (b) => ({ success: true, data: { item: { id: 'th_1', ...b, title: 'other' } } })
    const r = await runCli(['t', 'thing', 'update', 'th_1', '--json', '{"title":"mine"}'], env())
    expect(r.code).toBe(EXIT.MISMATCH)
    expect(JSON.parse(r.stderr).error.mismatch).toEqual([{ field: 'title', sent: 'mine', saved: 'other' }])
  })

  test('server normalization is not a mismatch', async () => {
    reply = () => ({
      success: true,
      data: { name: 'Acme', amount: 100, closeDate: '2026-10-23T00:00:00.000Z', memo: null, tags: [{ n: 1 }] },
    })
    const r = await create({ name: '  Acme ', amount: '100', closeDate: '2026-10-23', memo: '', tags: [{ n: '1' }] })
    expect(r.code).toBe(EXIT.OK)
    expect(r.stderr).toBe('')
  })

  test('a key the server does not echo is skipped', async () => {
    reply = () => ({ success: true, data: { id: 'it_9' } })
    const r = await create({ name: 'A', secretNote: 'x' })
    expect(r.code).toBe(EXIT.OK)
  })

  test('--dry-run and --no-verify skip the check', async () => {
    reply = (b) => ({ success: true, data: { ...b, qty: 99 } })
    expect((await create({ qty: 1 }, '--dry-run')).code).toBe(EXIT.OK)
    const r = await create({ qty: 1 }, '--no-verify')
    expect(r.code).toBe(EXIT.OK)
    expect(server.seen.at(-1)!.body).toEqual({ qty: 1 })
  })

  test('a server action is not checked', async () => {
    reply = () => ({ success: true, data: { note: 'changed' } })
    const r = await runCli(['t', 'act', 'run', '--note', 'hi'], env())
    expect(r.code).toBe(EXIT.OK)
  })
})

describe('compareSaved', () => {
  test('reports only differing shared keys', () => {
    expect(compareSaved({ a: 1, b: 'x', c: true }, { a: 2, b: 'x' })).toEqual([{ field: 'a', sent: 1, saved: 2 }])
  })
  test('skips control keys', () => {
    expect(compareSaved({ dryRun: true, expectVersion: 3, version: 3, updatedAt: '2020-01-01' }, { dryRun: false, expectVersion: 4, version: 4, updatedAt: '2026-01-01' })).toEqual([])
  })
  test('normalization rules', () => {
    expect(sameValue(' a ', 'a')).toBe(true)
    expect(sameValue('100', 100)).toBe(true)
    expect(sameValue('100.50', 100.5)).toBe(true)
    expect(sameValue(null, '')).toBe(true)
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue('true', true)).toBe(true)
    expect(sameValue('2026-10-23', '2026-10-23T00:00:00.000Z')).toBe(true)
    expect(sameValue('2026-10-23', '2026-10-22T15:00:00Z')).toBe(true)
    expect(sameValue('2026-10-23T09:00:00+09:00', '2026-10-23T00:00:00Z')).toBe(true)
    expect(sameValue({ x: [1, '2'] }, { x: ['1', 2] })).toBe(true)
  })
  test('real differences still count', () => {
    expect(sameValue('a', 'b')).toBe(false)
    expect(sameValue(1, 2)).toBe(false)
    expect(sameValue('2026-10-23', '2026-10-25T00:00:00Z')).toBe(false)
    expect(sameValue('2026-10-23T01:00:00Z', '2026-10-23T02:00:00Z')).toBe(false)
    expect(sameValue([1], [1, 2])).toBe(false)
    expect(sameValue('x', null)).toBe(false)
  })
  test('non-object input compares nothing', () => {
    expect(compareSaved({ a: 1 }, null)).toEqual([])
    expect(compareSaved({ a: 1 }, [1])).toEqual([])
  })
})

describe('savedRecord', () => {
  test('data record, wrapped record, and unknown shapes', () => {
    expect(savedRecord({ success: true, data: { a: 1 } }, { a: 1 })).toEqual({ a: 1 })
    expect(savedRecord({ success: true, data: { deal: { a: 1 } } }, { a: 1 })).toEqual({ a: 1 })
    expect(savedRecord({ success: true, data: [{ a: 1 }] }, { a: 1 })).toBeNull()
    expect(savedRecord({ success: true, data: null }, { a: 1 })).toBeNull()
    expect(savedRecord({ success: true, data: { x: { a: 1 }, y: { a: 2 } } }, { a: 1 })).toBeNull()
  })
})
