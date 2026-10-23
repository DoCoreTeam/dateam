// A file response (PDF, image) is written to --out byte for byte; stdout stays one JSON value.
// Found in P0159: res.text() turned a PDF into {"text":"%PDF-..."} and the file was unusable.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../src/exit.ts'
import { fakeServer, runCli, tempDir, writeSyncedSpec, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_testkey_0123456789abcdef'
/** Bytes that do not survive a UTF-8 round trip, the way a real PDF or PNG does not */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3])
const PDF = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), 0xe2, 0xe3, 0xcf, 0xd3, 0x00, 0xff])

let server: FakeServer
let dir: string
const seen: URL[] = []

beforeAll(() => {
  server = fakeServer((_req, url) => {
    seen.push(url)
    if (url.pathname.endsWith('/items/png')) return new Response(PNG, { headers: { 'content-type': 'image/png' } })
    if (url.pathname.endsWith('/items/pdf')) return new Response(PDF, { headers: { 'content-type': 'application/pdf; charset=binary' } })
    if (url.pathname.endsWith('/items/text')) return new Response('plain words', { headers: { 'content-type': 'text/plain' } })
    if (url.pathname.endsWith('/items/err')) return new Response(JSON.stringify({ success: false, error: 'missing' }), { status: 404, headers: { 'content-type': 'application/json' } })
    return Response.json({ success: true, data: { id: 'it_1' } })
  })
  dir = tempDir()
  writeSyncedSpec(dir)
})
afterAll(() => server.stop())

const env = () => ({ TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })

test('a PNG response lands in --out unchanged and stdout describes it', async () => {
  const out = join(dir, 'page.png')
  const r = await runCli(['t', 'item', 'get', 'png', '--out', out], env())
  expect(r.code).toBe(EXIT.OK)
  expect(new Uint8Array(readFileSync(out))).toEqual(PNG)
  expect(JSON.parse(r.stdout)).toEqual({ file: out, bytes: PNG.byteLength, contentType: 'image/png' })
  expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1)
})

test('a PDF response keeps every byte, the content type drops its parameters', async () => {
  const out = join(dir, 'quote.pdf')
  const r = await runCli(['t', 'item', 'get', 'pdf', '--out', out], env())
  expect(r.code).toBe(EXIT.OK)
  expect(new Uint8Array(readFileSync(out))).toEqual(PDF)
  expect(JSON.parse(r.stdout).contentType).toBe('application/pdf')
})

test('--out is never sent to the server', async () => {
  seen.length = 0
  await runCli(['t', 'item', 'get', 'png', '--out', join(dir, 'x.png')], env())
  expect(seen[0].searchParams.has('out')).toBe(false)
})

test('a file without --out is a usage error and nothing is written', async () => {
  const r = await runCli(['t', 'item', 'get', 'pdf'], env())
  expect(r.code).toBe(EXIT.USAGE)
  expect(JSON.parse(r.stderr).error.code).toBe('out_required')
  expect(r.stdout).toBe('')
})

test('the raw api command saves files the same way', async () => {
  const out = join(dir, 'raw.png')
  const r = await runCli(['api', 'GET', 'items/png', '--out', out], env())
  expect(r.code).toBe(EXIT.OK)
  expect(new Uint8Array(readFileSync(out))).toEqual(PNG)
})

test('JSON and text responses are unchanged, --out does not create a file for them', async () => {
  const out = join(dir, 'unused.json')
  const json = await runCli(['t', 'item', 'get', 'it_1', '--out', out], env())
  expect(JSON.parse(json.stdout)).toEqual({ success: true, data: { id: 'it_1' } })
  expect(existsSync(out)).toBe(false)
  const text = await runCli(['t', 'item', 'get', 'text'], env())
  expect(JSON.parse(text.stdout)).toEqual({ text: 'plain words' })
})

test('an error stays an error envelope even with --out, and the key never prints', async () => {
  const r = await runCli(['t', 'item', 'get', 'err', '--out', join(dir, 'e.pdf')], env())
  expect(r.code).toBe(EXIT.NOT_FOUND)
  expect(r.stderr + r.stdout).not.toContain(KEY)
})
