/**
 * One HTTP call and the mapping of its result onto the output contract.
 *
 * Success: the response body is returned and printed to stdout as one JSON value.
 * A file response (PDF, image) comes back as bytes; run.ts writes it to --out and prints a summary.
 * Anything else: a CliError carrying the error envelope and exit code.
 */
import type { Context } from './context.ts'
import { VERSION } from './context.ts'
import { CliError, EXIT, defaultCodeForStatus, exitForStatus } from './exit.ts'

export interface RequestInput {
  method: string
  url: string
  key: string
  body?: unknown
  idempotencyKey?: string
}

const DEFAULT_TIMEOUT_MS = 30_000

function timeoutMs(ctx: Context): number {
  const n = Number(ctx.env.TEAMDA_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

export function buildHeaders(input: RequestInput): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-API-Key': input.key,
    'X-Agent': `teamda/${VERSION}`,
    'X-Request-Id': crypto.randomUUID(),
  }
  if (input.body !== undefined) headers['Content-Type'] = 'application/json'
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey
  return headers
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** Look for a field at the top, under `error`, and under `data`. Servers disagree on where. */
function pick(body: unknown, ...names: string[]): string | undefined {
  if (!isObj(body)) return undefined
  const layers = [body, isObj(body.error) ? body.error : undefined, isObj(body.data) ? body.data : undefined]
  for (const layer of layers) {
    if (!layer) continue
    for (const n of names) {
      const v = str(layer[n])
      if (v) return v
    }
  }
  return undefined
}

function messageOf(body: unknown, status: number, statusText: string): string {
  if (isObj(body)) {
    if (typeof body.error === 'string') return body.error
    const m = pick(body, 'message')
    if (m) return m
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 500)
  return statusText || `HTTP ${status}`
}

export function errorFromResponse(status: number, statusText: string, body: unknown): CliError {
  if (status === 202) {
    return new CliError(EXIT.APPROVAL_REQUIRED, {
      code: 'approval_required',
      message: pick(body, 'message') ?? 'this key lacks the scope; an approval request was created',
      status,
      approvalId: pick(body, 'approvalId', 'approval_id', 'approvalRequestId'),
      requiredScope: pick(body, 'requiredScope', 'required_scope'),
    })
  }
  return new CliError(exitForStatus(status), {
    code: pick(body, 'code') ?? defaultCodeForStatus(status),
    message: messageOf(body, status, statusText),
    status,
    requiredScope: pick(body, 'requiredScope', 'required_scope'),
  })
}

/** A successful response that is a file (PDF, image, ...), kept as bytes so nothing is re-encoded. */
export interface FileBody {
  kind: 'file'
  bytes: Uint8Array
  contentType: string
}

export function isFileBody(v: unknown): v is FileBody {
  return isObj(v) && v.kind === 'file' && v.bytes instanceof Uint8Array
}

/** JSON and text stay text; anything else that succeeds is a file. Errors are always read as text. */
function isFileType(contentType: string): boolean {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  return ct !== '' && !ct.startsWith('text/') && !ct.endsWith('json') && !ct.endsWith('+json')
}

async function readBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? ''
  if (res.status >= 200 && res.status < 300 && isFileType(contentType)) {
    return { kind: 'file', bytes: new Uint8Array(await res.arrayBuffer()), contentType: contentType.split(';')[0].trim() } satisfies FileBody
  }
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

/** 429: wait Retry-After and try again this many times before exit 6. */
export const RATE_LIMIT_RETRIES = 3
/** 5xx: try again this many times before exit 8. */
export const SERVER_RETRIES = 1
/** Wait when Retry-After is missing or unreadable, and the 5xx backoff. */
export const DEFAULT_RETRY_WAIT_MS = 1_000
/** Longest single wait, so a huge Retry-After cannot hang the CLI. */
export const MAX_RETRY_WAIT_MS = 60_000

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Retry-After as delta seconds or an HTTP-date, clamped to [0, MAX_RETRY_WAIT_MS]. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  const v = header?.trim() ?? ''
  if (v === '') return DEFAULT_RETRY_WAIT_MS
  let ms: number
  if (/^[+-]?\d+(\.\d+)?$/.test(v)) {
    if (v.startsWith('-')) return DEFAULT_RETRY_WAIT_MS
    ms = Number(v) * 1000
  } else {
    const at = Date.parse(v)
    if (!Number.isFinite(at)) return DEFAULT_RETRY_WAIT_MS
    ms = at - now
  }
  return Math.min(Math.max(0, Math.round(ms)), MAX_RETRY_WAIT_MS)
}

/** How long to wait before trying again, or null when this response is final. */
function retryWait(res: Response, attempt: { rate: number; server: number }): number | null {
  if (res.status === 429 && attempt.rate < RATE_LIMIT_RETRIES) {
    attempt.rate++
    return retryAfterMs(res.headers.get('retry-after'))
  }
  if (res.status >= 500 && res.status < 600 && attempt.server < SERVER_RETRIES) {
    attempt.server++
    return DEFAULT_RETRY_WAIT_MS
  }
  return null
}

async function send(ctx: Context, input: RequestInput, headers: Record<string, string>): Promise<Response> {
  try {
    return await ctx.fetch(input.url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs(ctx)),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new CliError(EXIT.UNKNOWN, {
      code: timedOut ? 'timeout' : 'network_error',
      message: timedOut ? `no response within ${timeoutMs(ctx)} ms` : `cannot reach ${new URL(input.url).origin}`,
    })
  }
}

/**
 * One logical call. 429 is retried up to RATE_LIMIT_RETRIES times after Retry-After,
 * 5xx up to SERVER_RETRIES times after DEFAULT_RETRY_WAIT_MS. Every attempt sends the same
 * headers and body, so a write keeps one Idempotency-Key (generated when not given).
 * Network failures and timeouts are not retried.
 */
export async function request(ctx: Context, input: RequestInput): Promise<unknown> {
  const idempotencyKey = input.idempotencyKey
    ?? (WRITE_METHODS.has(input.method.toUpperCase()) ? crypto.randomUUID() : undefined)
  const headers = buildHeaders({ ...input, idempotencyKey })
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const attempt = { rate: 0, server: 0 }
  for (;;) {
    const res = await send(ctx, input, headers)
    const wait = retryWait(res, attempt)
    if (wait !== null) {
      await res.body?.cancel()
      await sleep(wait)
      continue
    }
    const body = await readBody(res)
    if (res.status >= 200 && res.status < 300 && res.status !== 202) return body
    throw errorFromResponse(res.status, res.statusText, body)
  }
}
