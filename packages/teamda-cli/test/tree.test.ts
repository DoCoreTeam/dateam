import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import embedded from '../src/generated/spec.json'
import { buildCommandTree, resolveCommand, type OpenApiSpec } from '../src/spec.ts'
import { buildRequest } from '../src/commands/invoke.ts'
import { parseArgs } from '../src/args.ts'
import { EXIT, CliError } from '../src/exit.ts'

const spec = embedded as OpenApiSpec
const xcliOps = Object.entries(spec.paths ?? {}).flatMap(([path, ops]) =>
  Object.entries(ops).filter(([, op]) => op['x-cli']).map(([method, op]) => ({ path, method, cli: op['x-cli'] as string })))

test('every x-cli operation becomes exactly one command', () => {
  const tree = buildCommandTree(spec)
  expect(xcliOps.length).toBeGreaterThan(700)
  expect(tree.commands.length).toBe(xcliOps.length)
  expect(tree.byCli.size).toBe(tree.commands.length)
  for (const op of xcliOps) {
    const cmd = tree.byCli.get(op.cli)
    expect(cmd?.path).toBe(op.path)
    expect(cmd?.method).toBe(op.method.toUpperCase())
  }
})

test('embedded spec matches the web generator output when both exist', () => {
  const source = join(import.meta.dir, '..', '..', '..', 'apps', 'web', 'lib', 'actions', 'generated', 'openapi.json')
  if (!existsSync(source)) return
  const web = JSON.parse(readFileSync(source, 'utf8')) as OpenApiSpec
  expect(buildCommandTree(web).commands.map((c) => c.cli)).toEqual(buildCommandTree(spec).commands.map((c) => c.cli))
})

test('a duplicate x-cli is refused', () => {
  const dup: OpenApiSpec = {
    paths: {
      '/a': { get: { 'x-cli': 'x y z' } },
      '/b': { post: { 'x-cli': 'x y z' } },
    },
  }
  expect(() => buildCommandTree(dup)).toThrow(/duplicate x-cli/)
})

test('every command resolves to itself by its own words', () => {
  const tree = buildCommandTree(spec)
  for (const c of tree.commands) expect(resolveCommand(tree, c.words)?.command.cli).toBe(c.cli)
})

test('longest match wins when one command is a prefix of another', () => {
  const tree = buildCommandTree(spec)
  if (!tree.byCli.has('gpu quote') || !tree.byCli.has('gpu quote list')) return
  expect(resolveCommand(tree, ['gpu', 'quote', 'list'])?.command.cli).toBe('gpu quote list')
  expect(resolveCommand(tree, ['gpu', 'quote'])?.command.cli).toBe('gpu quote')
})

test('path params fill from positionals or flags; missing ones are a usage error', () => {
  const tree = buildCommandTree(spec)
  const cmd = tree.commands.find((c) => c.pathParams.length === 1 && c.method === 'GET')
  if (!cmd) throw new Error('no GET command with one path param')
  const name = cmd.pathParams[0]
  const a = buildRequest(cmd, parseArgs([]), ['abc'])
  expect(a.path).toBe(cmd.path.replace(`{${name}}`, 'abc'))
  const b = buildRequest(cmd, parseArgs([`--${name}`, 'x/y']), [])
  expect(b.path).toBe(cmd.path.replace(`{${name}}`, 'x%2Fy'))
  try {
    buildRequest(cmd, parseArgs([]), [])
    throw new Error('should have thrown')
  } catch (e) {
    expect(e instanceof CliError && e.exit).toBe(EXIT.USAGE)
  }
})

test('server action: named flags and leftover positionals become the body', () => {
  const tree = buildCommandTree(spec)
  const cmd = tree.commands.find((c) => c.kind === 'action' && c.bodyFields?.includes('id'))
  if (!cmd) throw new Error('no action with an id field')
  const r = buildRequest(cmd, parseArgs(['--id', 'q1', '--dry-run']), [])
  expect(r.method).toBe('POST')
  expect(r.body).toEqual({ id: 'q1' })
  expect(r.query.get('dryRun')).toBe('1')
  const unknown = () => buildRequest(cmd, parseArgs(['--nope', '1']), [])
  expect(unknown).toThrow(/unknown flag/)
})
