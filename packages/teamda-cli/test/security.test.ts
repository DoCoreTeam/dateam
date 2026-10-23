import { test, expect, afterEach } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../src/exit.ts'
import { KEY_VISIBLE_CHARS } from '../src/context.ts'
import { anyFileContains, fakeServer, runCli, tempDir, writeSyncedSpec } from './helpers.ts'

const KEY = 'ax_live_SECRETVALUE_abcdef0123456789'

afterEach(async () => {
  await runCli(['auth', 'logout'], { TEAMDA_CONFIG_DIR: tempDir() })
})

const SECRET_ARGV: string[][] = [
  ['auth', 'login', '--key', KEY],
  ['auth', 'login', `--key=${KEY}`],
  ['crm', 'quote', 'list', '--api-key', KEY],
  ['api', 'GET', 'x', '--token', KEY],
  ['sync', '--password', KEY],
]

for (const argv of SECRET_ARGV) {
  test(`secret on argv is refused with exit 2: ${argv.slice(0, 3).join(' ')}`, async () => {
    const r = await runCli(argv, { TEAMDA_CONFIG_DIR: tempDir() })
    expect(r.code).toBe(EXIT.USAGE)
    expect(JSON.parse(r.stderr).error.code).toBe('secret_on_argv')
    expect(r.stdout + r.stderr).not.toContain(KEY)
  })
}

test('the compiled entry refuses --key too', async () => {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'main.ts'), 'auth', 'login', '--key', KEY], {
    env: { PATH: process.env.PATH ?? '', TEAMDA_CONFIG_DIR: tempDir(), TEAMDA_CREDENTIAL_BACKEND: 'memory' },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [out, err, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited]
  expect(code).toBe(EXIT.USAGE)
  expect(JSON.parse(err).error.code).toBe('secret_on_argv')
  expect(out + err).not.toContain(KEY)
})

test('login from a key file stores in the credential store, prints 12 chars, writes no plaintext file', async () => {
  const dir = tempDir()
  const keyFile = join(tempDir(), 'key.txt')
  writeFileSync(keyFile, `${KEY}\n`)
  const r = await runCli(['auth', 'login', '--key-file', keyFile], { TEAMDA_CONFIG_DIR: dir })
  expect(r.code).toBe(0)
  const out = JSON.parse(r.stdout)
  expect(out).toEqual({ stored: true, backend: 'memory', key: `${KEY.slice(0, KEY_VISIBLE_CHARS)}...` })
  expect(r.stdout + r.stderr).not.toContain(KEY.slice(0, KEY_VISIBLE_CHARS + 1))

  await runCli(['config', 'set', 'base-url', 'https://example.test'], { TEAMDA_CONFIG_DIR: dir })
  expect(anyFileContains(dir, KEY.slice(KEY_VISIBLE_CHARS))).toEqual([])

  const status = await runCli(['auth', 'status'], { TEAMDA_CONFIG_DIR: dir })
  expect(status.code).toBe(0)
  expect(JSON.parse(status.stdout)).toEqual({ authenticated: true, source: 'store', key: `${KEY.slice(0, KEY_VISIBLE_CHARS)}...` })
  expect(status.stdout).not.toContain(KEY.slice(0, KEY_VISIBLE_CHARS + 1))
})

test('login from stdin works and the stored key is used for requests', async () => {
  const dir = tempDir()
  writeSyncedSpec(dir)
  const server = fakeServer((req) => Response.json({ success: true, data: { gotKey: req.headers.get('x-api-key') === KEY } }))
  const login = await runCli(['auth', 'login', '--key-file', '-'], { TEAMDA_CONFIG_DIR: dir }, `${KEY}\n`)
  expect(login.code).toBe(0)
  const r = await runCli(['t', 'item', 'get', '1'], { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base })
  server.stop()
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout).data.gotKey).toBe(true)
})

test('a server that echoes the key is redacted to 12 chars in output', async () => {
  const dir = tempDir()
  writeSyncedSpec(dir)
  const server = fakeServer((req) => Response.json({ success: false, error: `bad key ${req.headers.get('x-api-key')}` }, { status: 401 }))
  const r = await runCli(['t', 'item', 'get', '1'], { TEAMDA_CONFIG_DIR: dir, TEAMDA_BASE_URL: server.base, TEAMDA_API_KEY: KEY })
  server.stop()
  expect(r.code).toBe(EXIT.AUTH)
  expect(r.stderr).not.toContain(KEY)
  expect(r.stderr).toContain(`${KEY.slice(0, KEY_VISIBLE_CHARS)}...`)
})

test('auth status with no key exits 3', async () => {
  const r = await runCli(['auth', 'status'], { TEAMDA_CONFIG_DIR: tempDir() })
  expect(r.code).toBe(EXIT.AUTH)
})

test('a key file holding something other than one token is refused', async () => {
  const keyFile = join(tempDir(), 'bad.txt')
  writeFileSync(keyFile, 'two words here')
  const r = await runCli(['auth', 'login', '--key-file', keyFile], { TEAMDA_CONFIG_DIR: tempDir() })
  expect(r.code).toBe(EXIT.USAGE)
  expect(JSON.parse(r.stderr).error.code).toBe('key_invalid')
})
