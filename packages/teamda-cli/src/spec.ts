/**
 * The command tree, built from the OpenAPI spec at runtime. No command is written by hand.
 *
 * Every operation that carries `x-cli` becomes one command whose words are the `x-cli` value.
 * A spec synced with `teamda sync` wins over the one embedded at build time.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import embedded from './generated/spec.json'
import type { Context } from './context.ts'
import { configDir } from './config.ts'
import { inputsOf, type CommandInputs } from './inputs.ts'

export interface OpenApiParam {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: unknown
  description?: string
}

export interface OpenApiOperation {
  operationId?: string
  summary?: string
  'x-cli'?: string
  'x-scope'?: string
  'x-kind'?: string
  'x-args'?: string[]
  'x-query-complete'?: boolean
  parameters?: OpenApiParam[]
  requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> }
}

export interface OpenApiSpec {
  servers?: { url: string }[]
  paths?: Record<string, Record<string, OpenApiOperation>>
  'x-spec-hash'?: string
}

export interface Command {
  cli: string
  words: string[]
  method: string
  path: string
  scope: string
  summary: string
  operationId: string
  kind: string
  pathParams: string[]
  queryParams: string[]
  /** null when the body accepts any field, a list when the schema names its fields */
  bodyFields: string[] | null
  hasBody: boolean
  /** server action positional argument names, in order */
  actionArgs: string[]
  /** query and body inputs with their types, for help and the pre-send checks */
  inputs: CommandInputs
}

export interface CommandTree {
  commands: Command[]
  byCli: Map<string, Command>
  serverPath: string
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

function bodyFieldsOf(op: OpenApiOperation): { hasBody: boolean; fields: string[] | null } {
  const schema = op.requestBody?.content?.['application/json']?.schema
  if (!op.requestBody) return { hasBody: false, fields: null }
  const props = schema?.properties
  if (!props) return { hasBody: true, fields: null }
  return { hasBody: true, fields: Object.keys(props) }
}

function toCommand(path: string, method: string, op: OpenApiOperation): Command | null {
  const cli = op['x-cli']?.trim()
  if (!cli) return null
  const params = op.parameters ?? []
  const { hasBody, fields } = bodyFieldsOf(op)
  const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
  return {
    cli,
    words: cli.split(/\s+/),
    method: method.toUpperCase(),
    path,
    scope: op['x-scope'] ?? 'read',
    summary: op.summary ?? op.operationId ?? cli,
    operationId: op.operationId ?? cli,
    kind: op['x-kind'] ?? 'route',
    pathParams,
    queryParams: params.filter((p) => p.in === 'query').map((p) => p.name),
    bodyFields: fields,
    hasBody,
    actionArgs: op['x-args'] ?? [],
    inputs: inputsOf(op, hasBody),
  }
}

/** Throws on two operations sharing one `x-cli`, because one of them would be unreachable. */
export function buildCommandTree(spec: OpenApiSpec): CommandTree {
  const commands: Command[] = []
  const byCli = new Map<string, Command>()
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!METHODS.has(method)) continue
      const cmd = toCommand(path, method, op)
      if (!cmd) continue
      const seen = byCli.get(cmd.cli)
      if (seen) throw new Error(`duplicate x-cli "${cmd.cli}": ${seen.method} ${seen.path} and ${cmd.method} ${cmd.path}`)
      byCli.set(cmd.cli, cmd)
      commands.push(cmd)
    }
  }
  commands.sort((a, b) => a.cli.localeCompare(b.cli))
  const server = spec.servers?.[0]?.url ?? '/api/public/v1'
  return { commands, byCli, serverPath: server.replace(/\/+$/, '') }
}

export function countCliOperations(spec: OpenApiSpec): number {
  return Object.values(spec.paths ?? {})
    .flatMap((ops) => Object.values(ops))
    .filter((op) => typeof op['x-cli'] === 'string' && op['x-cli'].trim() !== '').length
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export const SYNCED_SPEC_FILE = 'spec.json'
export const SYNCED_HASH_FILE = 'spec.sha256'

export interface LoadedSpec {
  spec: OpenApiSpec
  source: 'synced' | 'embedded'
}

/** Prefer the synced spec. Fall back to the embedded one when the synced file is absent or unusable. */
export function loadSpec(ctx: Context): LoadedSpec {
  const file = join(configDir(ctx), SYNCED_SPEC_FILE)
  if (existsSync(file)) {
    try {
      const spec = JSON.parse(readFileSync(file, 'utf8')) as OpenApiSpec
      if (countCliOperations(spec) > 0) return { spec, source: 'synced' }
    } catch {
      // unreadable cache: use the embedded spec rather than fail every command
    }
  }
  return { spec: embedded as OpenApiSpec, source: 'embedded' }
}

export interface Resolved {
  command: Command
  rest: string[]
}

/** Longest match on leading words, so `gpu quote list` beats `gpu quote`. */
export function resolveCommand(tree: CommandTree, positionals: string[]): Resolved | null {
  for (let n = Math.min(positionals.length, 6); n > 0; n--) {
    const cmd = tree.byCli.get(positionals.slice(0, n).join(' '))
    if (cmd) return { command: cmd, rest: positionals.slice(n) }
  }
  return null
}

/** Commands under a word prefix, for the "did you mean" list on a partial command. */
export function commandsUnder(tree: CommandTree, positionals: string[]): Command[] {
  const prefix = positionals.join(' ')
  return tree.commands.filter((c) => c.cli === prefix || c.cli.startsWith(`${prefix} `))
}
