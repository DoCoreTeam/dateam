/**
 * Web = CLI: every command sends the request the web gateway maps to the same handler.
 *
 * For each command the request built from positional values must hit the spec path with those
 * values filled in, and that method + path must be a row of the web gateway table (generated
 * table.ts) or a hand-written public route. The web side checks that each row points at the
 * handler the screen uses (apps/web/lib/actions/parity.test.ts).
 */
import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import embedded from '../src/generated/spec.json'
import { buildCommandTree, type OpenApiSpec } from '../src/spec.ts'
import { buildRequest } from '../src/commands/invoke.ts'
import { parseArgs } from '../src/args.ts'

const spec = embedded as OpenApiSpec
const WEB = join(import.meta.dir, '..', '..', '..', 'apps', 'web')
const TABLE = join(WEB, 'lib', 'actions', 'generated', 'table.ts')

function mountedKeys(): Set<string> | null {
  if (!existsSync(TABLE)) return null
  const text = readFileSync(TABLE, 'utf8')
  return new Set([...text.matchAll(/"method":"(\w+)","mount":"([^"]+)"/g)].map((m) => `${m[1]} ${m[2].replace(/\{(\w+)\*\}/g, '{$1}')}`))
}

function publicRouteHas(method: string, path: string): boolean {
  const dir = join(WEB, 'app', 'api', 'public', 'v1', ...path.split('/').filter(Boolean).map((s) => s.replace(/^\{(\w+)\}$/, '[$1]')))
  const file = join(dir, 'route.ts')
  if (!existsSync(file)) return false
  return new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`).test(readFileSync(file, 'utf8'))
}

test('every command fills its path and lands on a gateway row or a public route', () => {
  const tree = buildCommandTree(spec)
  const mounted = mountedKeys()
  expect(tree.commands.length).toBeGreaterThan(700)
  const lost: string[] = []
  for (const cmd of tree.commands) {
    const names = [...cmd.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    const values = names.map((_, i) => `v${i}`)
    const req = buildRequest(cmd, parseArgs([]), values)
    let expected = cmd.path
    names.forEach((n, i) => { expected = expected.replace(`{${n}}`, values[i]) })
    if (req.method !== cmd.method || req.path !== expected) lost.push(`${cmd.cli}: ${req.method} ${req.path}`)
    if (mounted && !mounted.has(`${cmd.method} ${cmd.path}`) && !publicRouteHas(cmd.method, cmd.path)) lost.push(`${cmd.cli}: no handler for ${cmd.method} ${cmd.path}`)
  }
  expect(lost).toEqual([])
})
