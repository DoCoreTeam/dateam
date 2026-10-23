/**
 * One HTTP call and the mapping of its result onto the output contract.
 *
 * Success: the response body is returned and printed to stdout as one JSON value.
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

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

export async function request(ctx: Context, input: RequestInput): Promise<unknown> {
  let res: Response
  try {
    res = await ctx.fetch(input.url, {
      method: input.method,
      headers: buildHeaders(input),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs(ctx)),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new CliError(EXIT.NETWORK, {
      code: timedOut ? 'timeout' : 'network_error',
      message: timedOut ? `no response within ${timeoutMs(ctx)} ms` : `cannot reach ${new URL(input.url).origin}`,
    })
  }
  const body = await readBody(res)
  if (res.status >= 200 && res.status < 300 && res.status !== 202) return body
  throw errorFromResponse(res.status, res.statusText, body)
}
