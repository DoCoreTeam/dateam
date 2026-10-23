/**
 * Turn a spec command plus argv into one HTTP request.
 *
 * Rules, kept short so they can be documented in one paragraph:
 * - path params (`{id}`) come from `--id` or, in order, from positionals after the command words
 * - GET, and any method without a request body, sends the remaining flags as query parameters
 * - otherwise the body is `--json` merged with the flags (flags win)
 * - server actions take leftover positionals as the `args` array
 * - `--dry-run` adds `dryRun=1`; `--idempotency-key` becomes the Idempotency-Key header
 */
import type { Context } from '../context.ts'
import { flagValue, readJsonFlag, takeFlag, type ParsedArgs } from '../args.ts'
import { resolveBaseUrl } from '../config.ts'
import { usage, CliError, EXIT } from '../exit.ts'
import { request } from '../http.ts'
import type { Command } from '../spec.ts'

export interface BuiltRequest {
  method: string
  path: string
  query: URLSearchParams
  body?: unknown
  idempotencyKey?: string
  dryRun: boolean
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function fillPath(cmd: Command, rest: string[], flags: Map<string, string>): { path: string; rest: string[] } {
  let path = cmd.path
  const left = [...rest]
  for (const name of cmd.pathParams) {
    const value = takeFlag(flags, name) ?? left.shift()
    if (value === undefined || value === '') {
      throw usage('missing_param', `${cmd.cli}: missing <${name}> (positional or --${name})`)
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value))
  }
  return { path, rest: left }
}

function initialBody(cmd: Command, json: unknown): Json {
  if (json === undefined) return {}
  if (Array.isArray(json) && cmd.kind === 'action') return { args: json }
  if (!isObj(json)) throw usage('invalid_json', '--json must be an object (or an args array for a server action)')
  return { ...json }
}

export function buildRequest(cmd: Command, parsed: ParsedArgs, restWords: string[]): BuiltRequest {
  const flags = new Map(parsed.flags)
  const json = readJsonFlag(takeFlag(flags, 'json'))
  const idempotencyKey = takeFlag(flags, 'idempotency-key')
  const dryRun = takeFlag(flags, 'dry-run') === 'true'
  const { path, rest } = fillPath(cmd, restWords, flags)
  const query = new URLSearchParams()
  if (dryRun) query.set('dryRun', '1')

  const sendsBody = cmd.hasBody && cmd.method !== 'GET'
  if (!sendsBody) {
    if (json !== undefined) throw usage('unexpected_body', `${cmd.cli} takes no body; pass flags as query parameters`)
    if (rest.length > 0) throw usage('unexpected_argument', `${cmd.cli}: unexpected argument "${rest[0]}"`)
    for (const [k, v] of flags) query.set(k, v)
    return { method: cmd.method, path, query, idempotencyKey, dryRun }
  }

  const body = initialBody(cmd, json)
  for (const [k, v] of flags) {
    if (cmd.bodyFields === null || cmd.bodyFields.includes(k)) { body[k] = flagValue(v); continue }
    if (cmd.queryParams.includes(k)) { query.set(k, v); continue }
    throw usage('unknown_flag', `${cmd.cli}: unknown flag --${k}`, { candidates: cmd.bodyFields.filter((f) => f !== 'args') })
  }
  if (rest.length > 0) {
    if (cmd.kind !== 'action') throw usage('unexpected_argument', `${cmd.cli}: unexpected argument "${rest[0]}"`)
    body.args = rest.map(flagValue)
  }
  return { method: cmd.method, path, query, body, idempotencyKey, dryRun }
}

/** Base URL origin plus the spec's server path. An absolute server URL keeps only its path. */
export function joinUrl(base: string, serverPath: string, path: string, query?: URLSearchParams): string {
  let prefix = serverPath
  if (/^https?:\/\//.test(serverPath)) prefix = new URL(serverPath).pathname
  prefix = prefix.replace(/\/+$/, '')
  const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : ''
  return `${base}${prefix}${path.startsWith('/') ? path : `/${path}`}${qs}`
}

export async function invoke(
  ctx: Context, cmd: Command, serverPath: string, parsed: ParsedArgs, rest: string[], key: string | null,
): Promise<unknown> {
  const built = buildRequest(cmd, parsed, rest)
  if (!key) throw new CliError(EXIT.AUTH, { code: 'auth_missing', message: 'no API key: run teamda auth login --key-file <path>, or set TEAMDA_API_KEY' })
  const base = resolveBaseUrl(ctx)
  return request(ctx, {
    method: built.method,
    url: joinUrl(base, serverPath, built.path, built.query),
    key,
    body: built.body,
    idempotencyKey: built.idempotencyKey,
  })
}
