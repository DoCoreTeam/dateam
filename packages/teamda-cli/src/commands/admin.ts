/**
 * Built-ins that do not come from the spec: auth, config, and the raw `api` escape hatch.
 */
import { readFileSync, existsSync } from 'node:fs'
import type { Context } from '../context.ts'
import { maskKey } from '../context.ts'
import { flagValue, readJsonFlag, takeFlag, type ParsedArgs } from '../args.ts'
import { CONFIG_KEYS, normalizeBaseUrl, readConfig, resolveBaseUrl, writeConfig } from '../config.ts'
import { KEY_PATTERN, credentialStore, resolveKey } from '../credentials.ts'
import { CliError, EXIT, usage } from '../exit.ts'
import { request } from '../http.ts'
import { joinUrl } from './invoke.ts'

async function readKeyInput(ctx: Context, parsed: ParsedArgs): Promise<string> {
  const file = parsed.flags.get('key-file')
  const fromStdin = parsed.flags.get('stdin') === 'true' || file === '-'
  let raw: string
  if (fromStdin) {
    raw = await ctx.readStdin()
  } else if (file && file !== 'true') {
    if (!existsSync(file)) throw usage('key_file_missing', `not found: ${file}`)
    raw = readFileSync(file, 'utf8')
  } else {
    throw usage('key_source_missing', 'auth login needs --key-file <path> or --key-file - (stdin)')
  }
  const key = raw.trim()
  if (!KEY_PATTERN.test(key)) throw usage('key_invalid', 'the key file does not hold a single key token')
  return key
}

export async function auth(ctx: Context, sub: string | undefined, parsed: ParsedArgs): Promise<unknown> {
  if (sub === 'login') {
    const key = await readKeyInput(ctx, parsed)
    const store = credentialStore(ctx)
    await store.set(key)
    return { stored: true, backend: store.name, key: maskKey(key) }
  }
  if (sub === 'status') {
    const found = await resolveKey(ctx)
    if (!found) throw new CliError(EXIT.AUTH, { code: 'auth_missing', message: 'no key stored and TEAMDA_API_KEY is not set' })
    return { authenticated: true, source: found.source, key: maskKey(found.key) }
  }
  if (sub === 'logout') {
    const store = credentialStore(ctx)
    await store.remove()
    return { removed: true, backend: store.name }
  }
  throw usage('unknown_command', 'auth: use login, status, or logout', { candidates: ['auth login', 'auth status', 'auth logout'] })
}

export function config(ctx: Context, positionals: string[]): unknown {
  const [sub, name, value] = positionals
  if (sub === 'get') return readConfig(ctx)
  if (sub === 'set') {
    if (name !== 'base-url') throw usage('unknown_config_key', `config keys: ${CONFIG_KEYS.join(', ')}`)
    if (!value) throw usage('missing_param', 'config set base-url <url>')
    const baseUrl = normalizeBaseUrl(value)
    writeConfig(ctx, { ...readConfig(ctx), baseUrl })
    return { baseUrl }
  }
  throw usage('unknown_command', 'config: use get, or set base-url <url>', { candidates: ['config get', 'config set base-url'] })
}

const RAW_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const PUBLIC_PREFIX = '/api/public/v1'

/** `teamda api <METHOD> <path>`. A path not starting with /api/ is taken as relative to /api/public/v1. */
export async function api(ctx: Context, positionals: string[], parsed: ParsedArgs, key: string | null): Promise<unknown> {
  const [rawMethod, rawPath, extra] = positionals
  const method = (rawMethod ?? '').toUpperCase()
  if (!RAW_METHODS.has(method) || !rawPath) throw usage('missing_param', 'api <GET|POST|PUT|PATCH|DELETE> <path> [--json body]')
  if (extra !== undefined) throw usage('unexpected_argument', `api: unexpected argument "${extra}"`)
  if (/^[a-z]+:\/\//i.test(rawPath)) throw usage('absolute_url_refused', 'api takes a path; the server comes from the base URL')
  if (!key) throw new CliError(EXIT.AUTH, { code: 'auth_missing', message: 'no API key: run teamda auth login --key-file <path>, or set TEAMDA_API_KEY' })

  const flags = new Map(parsed.flags)
  const json = readJsonFlag(takeFlag(flags, 'json'))
  const idempotencyKey = takeFlag(flags, 'idempotency-key')
  const query = new URLSearchParams()
  if (takeFlag(flags, 'dry-run') === 'true') query.set('dryRun', '1')

  let body: unknown
  if (method === 'GET' || method === 'DELETE') {
    if (json !== undefined && method === 'GET') throw usage('unexpected_body', 'GET takes no body')
    body = json
    for (const [k, v] of flags) query.set(k, v)
  } else {
    const merged: Record<string, unknown> = json && typeof json === 'object' && !Array.isArray(json) ? { ...json } : {}
    for (const [k, v] of flags) merged[k] = flagValue(v)
    body = Array.isArray(json) ? json : merged
  }

  const path = rawPath.startsWith('/api/') ? rawPath : `${PUBLIC_PREFIX}/${rawPath.replace(/^\/+/, '')}`
  const url = joinUrl(resolveBaseUrl(ctx), '', path, query)
  return request(ctx, { method, url, key, body, idempotencyKey })
}
