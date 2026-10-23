/**
 * Test helpers: an in-process context with captured output, a temp config dir, a fake server.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context, Env } from '../src/context.ts'
import { run } from '../src/run.ts'

export interface Captured {
  ctx: Context
  out: string[]
  err: string[]
  /** Every retry wait the CLI asked for, in ms. Nothing actually waits. */
  sleeps: number[]
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'teamda-test-'))
}

export function makeCtx(env: Env, stdin = ''): Captured {
  const out: string[] = []
  const err: string[] = []
  const sleeps: number[] = []
  const ctx: Context = {
    env: { TEAMDA_CREDENTIAL_BACKEND: 'memory', ...env },
    out: (t) => { out.push(t) },
    err: (t) => { err.push(t) },
    readStdin: async () => stdin,
    fetch: globalThis.fetch,
    platform: process.platform,
    sleep: async (ms) => { sleeps.push(ms) },
  }
  return { ctx, out, err, sleeps }
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  sleeps: number[]
}

export async function runCli(argv: string[], env: Env, stdin = ''): Promise<RunResult> {
  const c = makeCtx(env, stdin)
  const code = await run(argv, c.ctx)
  return { code, stdout: c.out.join(''), stderr: c.err.join(''), sleeps: c.sleeps }
}

/** A small spec the tests control, written as the synced spec in the given config dir. */
export const TEST_SPEC = {
  openapi: '3.1.0',
  servers: [{ url: '/api/public/v1' }],
  paths: {
    '/items/{id}': {
      get: { operationId: 't.item.get', summary: 'get item', 'x-cli': 't item get', 'x-scope': 'read', 'x-kind': 'route', parameters: [{ name: 'id', in: 'path', required: true }] },
      delete: { operationId: 't.item.rm', summary: 'remove item', 'x-cli': 't item rm', 'x-scope': 'delete', 'x-kind': 'route', parameters: [{ name: 'id', in: 'path', required: true }] },
    },
    '/items': {
      post: {
        operationId: 't.item.create', summary: 'create item', 'x-cli': 't item create', 'x-scope': 'write', 'x-kind': 'route',
        parameters: [{ name: 'dryRun', in: 'query' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
    '/actions/t/run': {
      post: {
        operationId: 't.act.run', summary: 'run action', 'x-cli': 't act run', 'x-scope': 'write', 'x-kind': 'action',
        'x-args': ['id', 'note'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: {}, note: {}, args: { type: 'array' } } } } } },
      },
    },
  },
}

export function writeSyncedSpec(dir: string, spec: unknown = TEST_SPEC): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec))
}

export interface Seen {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

export interface FakeServer {
  base: string
  seen: Seen[]
  stop: () => void
}

export function fakeServer(handler: (req: Request, url: URL) => Response | Promise<Response>): FakeServer {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const text = await req.clone().text()
      seen.push({ method: req.method, url, headers: req.headers, body: text ? JSON.parse(text) : undefined })
      return handler(req, url)
    },
  })
  return { base: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) }
}

export function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else out.push(f)
    }
  }
  walk(dir)
  return out
}

export function anyFileContains(dir: string, needle: string): string[] {
  return filesUnder(dir).filter((f) => readFileSync(f, 'utf8').includes(needle))
}
