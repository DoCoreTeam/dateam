import { test, expect, beforeAll, afterAll } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../src/exit.ts'
import { TEST_SPEC, fakeServer, runCli, tempDir, type FakeServer } from './helpers.ts'

const KEY = 'ax_live_synckey_0123456789abcdef'
let served: unknown = TEST_SPEC
let wrapped = true
let server: FakeServer

beforeAll(() => {
  server = fakeServer((_req, url) => {
    if (url.pathname === '/api/public/v1/openapi.json') return Response.json(wrapped ? { success: true, data: served } : served)
    return Response.json({ success: false, error: 'missing' }, { status: 404 })
  })
})
afterAll(() => server.stop())

test('sync caches only when the hash changes, and the runtime then prefers the synced spec', async () => {
  const dir = tempDir()
  const env = { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY }
  served = TEST_SPEC

  const first = await runCli(['sync'], env)
  expect(first.code).toBe(0)
  const a = JSON.parse(first.stdout)
  expect(a.updated).toBe(true)
  expect(a.previous).toBeNull()
  expect(a.operations).toBe(4)
  const specFile = join(dir, 'spec.json')
  const mtime = statSync(specFile).mtimeMs

  await Bun.sleep(20)
  const second = JSON.parse((await runCli(['sync'], env)).stdout)
  expect(second.updated).toBe(false)
  expect(second.sha256).toBe(a.sha256)
  expect(statSync(specFile).mtimeMs).toBe(mtime)

  const help = JSON.parse((await runCli(['help', '--json'], env)).stdout)
  expect(help.specSource).toBe('synced')
  expect(help.specHash).toBe(a.sha256)
  expect(help.commands.map((c: { cli: string }) => c.cli)).toContain('t item get')

  served = { ...TEST_SPEC, paths: { ...TEST_SPEC.paths, '/extra': { get: { 'x-cli': 't extra list', summary: 'x' } } } }
  const third = JSON.parse((await runCli(['sync'], env)).stdout)
  expect(third.updated).toBe(true)
  expect(third.previous).toBe(a.sha256)
  expect(third.operations).toBe(5)
})

test('a spec with no x-cli operations is refused and the cache is left as it was', async () => {
  const dir = tempDir()
  const env = { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY }
  served = TEST_SPEC
  await runCli(['sync'], env)
  const before = readFileSync(join(dir, 'spec.json'), 'utf8')
  served = { openapi: '3.1.0', paths: { '/x': { get: { summary: 'no cli' } } } }
  const r = await runCli(['sync'], env)
  expect(r.code).toBe(EXIT.SERVER)
  expect(JSON.parse(r.stderr).error.code).toBe('spec_invalid')
  expect(readFileSync(join(dir, 'spec.json'), 'utf8')).toBe(before)
})

test('sync accepts the bare OpenAPI document and the old envelope with the same hash', async () => {
  served = TEST_SPEC
  wrapped = false
  try {
    const bareDir = tempDir()
    const bare = await runCli(['sync'], { TEAMDA_CONFIG_DIR: bareDir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })
    expect(bare.code).toBe(0)
    const a = JSON.parse(bare.stdout)
    expect(a.updated).toBe(true)
    expect(a.operations).toBe(4)
    expect(JSON.parse(readFileSync(join(bareDir, 'spec.json'), 'utf8')).paths).toEqual(TEST_SPEC.paths)

    wrapped = true
    const env = { TEAMDA_CONFIG_DIR: bareDir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY }
    const again = JSON.parse((await runCli(['sync'], env)).stdout)
    expect(again.updated).toBe(false)
    expect(again.sha256).toBe(a.sha256)
  } finally {
    wrapped = true
  }
})

test('sync without a key exits 3 and writes nothing', async () => {
  const dir = tempDir()
  const r = await runCli(['sync'], { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base })
  expect(r.code).toBe(EXIT.AUTH)
  expect(existsSync(join(dir, 'spec.json'))).toBe(false)
})
