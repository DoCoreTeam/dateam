/**
 * 공개 API 관문 (P0158 I07)
 *
 * 정의 표(generated/table.ts)의 한 줄이 /api/public/v1/<내부 경로> 와 /api/public/v1/actions/<이름> 으로 불린다
 * 처리 함수는 화면이 쓰는 그 함수다, 관문은 키를 확인하고 키 소유자 문맥(acting-session)을 연 뒤 그대로 부른다
 *
 * 순서: 키 확인(만료) → 범위 판정 → 쓰기 분당 한도 → dryRun → 승인 요청 → 멱등 재생 → 실행 → 멱등 저장
 * 쓰기는 결과와 무관하게 api_write_audit 에 키 에이전트 요청id ip 와 함께 남는다
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, actingSessions } from '@/lib/supabase/server'
import { authenticatePublicApi, corsHeaders, optionsResponse, rateLimitHeaders, type ApiKeyContext } from '@/lib/publicApiAuth'
import { issueActingGrant, runActing } from './acting-session'
import { MODULES, MOUNTED, type MountedOp } from './generated/table'
import {
  IDEMPOTENCY_KEY_MAX, WRITE_LIMIT_PER_MINUTE, actionArgs, decideAccess, internalPath, isDryRun, isWrite,
  matchMount, publicPathOf, requestHash,
} from './dispatch-core'

const DROP_HEADERS = new Set(['x-api-key', 'authorization', 'cookie', 'content-length', 'idempotency-key', 'x-dry-run'])

interface CallInput {
  method: string
  origin: string
  search: string
  headers: Headers
  bodyText: string
}

interface AuditRow {
  ctx: ApiKeyContext
  op: MountedOp
  path: string
  status: number
  requestId: string
  agent: string | null
  ip: string | null
  dryRun?: boolean
  approvalId?: string | null
}

function json(body: unknown, status: number, request: NextRequest, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(request), ...extra } })
}

function agentOf(request: NextRequest): string | null {
  return (request.headers.get('x-agent') ?? request.headers.get('user-agent') ?? '').slice(0, 200) || null
}

function ipOf(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null
}

async function audit(row: AuditRow): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('api_write_audit').insert({
    key_id: row.ctx.keyId, user_id: row.ctx.userId, agent: row.agent, request_id: row.requestId, ip: row.ip,
    action_name: row.op.name, method: row.op.kind === 'action' ? 'ACTION' : row.op.method, path: row.path,
    status: row.status, dry_run: row.dryRun ?? false, approval_id: row.approvalId ?? null,
  })
  if (error) console.error('[dispatch] audit insert', error.code, row.op.name)
}

function forwardHeaders(src: Headers): Headers {
  const out = new Headers()
  src.forEach((v, k) => { if (!DROP_HEADERS.has(k.toLowerCase())) out.set(k, v) })
  return out
}

function digestOf(e: unknown): string {
  return typeof e === 'object' && e && 'digest' in e ? String((e as { digest: unknown }).digest) : ''
}

/** 정의 한 줄을 처리 함수로 부른다, 반드시 키 소유자 문맥 안에서 */
async function invoke(op: MountedOp, params: Record<string, string>, input: CallInput): Promise<Response> {
  const mod = await MODULES[op.module]()
  const handler = mod?.[op.exported]
  if (typeof handler !== 'function') return NextResponse.json({ success: false, error: 'not_mounted' }, { status: 501 })
  if (op.kind === 'route') {
    const url = new URL(internalPath(op.internal, params) + input.search, input.origin)
    const hasBody = input.method !== 'GET' && input.method !== 'HEAD' && input.bodyText !== ''
    const req = new NextRequest(url, { method: input.method, headers: forwardHeaders(input.headers), body: hasBody ? input.bodyText : undefined })
    return handler(req, { params: Promise.resolve(params) })
  }
  let body: unknown
  try {
    body = input.bodyText ? JSON.parse(input.bodyText) : undefined
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }
  try {
    const result = await handler(...actionArgs(op.params, body))
    return NextResponse.json({ success: true, data: result ?? null })
  } catch (e) {
    const digest = digestOf(e)
    if (digest.startsWith('NEXT_REDIRECT')) return NextResponse.json({ success: true, data: null, redirect: digest.split(';')[2] ?? null })
    if (digest.includes('404') || digest === 'NEXT_NOT_FOUND') return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
    console.error('[dispatch] action failed', op.name, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ success: false, error: 'action_failed' }, { status: 500 })
  }
}

/** 키 소유자 문맥을 열고 부른다, 승인 실행(I08)도 이 길을 쓴다 */
export async function runAsKeyOwner(
  owner: { userId: string; role: string; keyId: string; scopes: ApiKeyContext['scopes'] },
  requestId: string,
  op: MountedOp,
  params: Record<string, string>,
  input: CallInput,
): Promise<Response> {
  const minted = await actingSessions.sessionFor(owner.userId)
  if (!minted.ok) {
    console.error('[dispatch] acting session', minted.reason)
    return NextResponse.json({ success: false, error: 'session_unavailable' }, { status: 503 })
  }
  const grant = issueActingGrant({ ...owner, requestId, session: minted.session })
  return runActing(grant, () => invoke(op, params, input))
}

export function findMounted(name: string): MountedOp | undefined {
  return MOUNTED.find((o) => o.name === name)
}

async function readJson(res: Response): Promise<unknown | undefined> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return undefined
  try {
    return await res.clone().json()
  } catch {
    return undefined
  }
}

/** 모든 공개 경로가 지나는 입구, 겹치는 공개 라우트의 빠진 메서드도 이것을 재수출한다 */
export async function dispatchPublicApi(request: NextRequest): Promise<Response> {
  if (request.method === 'OPTIONS') return optionsResponse(request)
  const auth = await authenticatePublicApi(request, { deferScope: true })
  if ('error' in auth) return auth.error
  const ctx = auth.ctx
  const requestId = request.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID()
  const base = { ...rateLimitHeaders(ctx), 'X-Request-Id': requestId }
  const path = publicPathOf(request.nextUrl.pathname)
  const matched = matchMount(MOUNTED, request.method, path)
  if (!matched) return json({ success: false, error: 'not_found' }, 404, request, base)
  const { op, params } = matched

  const write = isWrite(op.scope)
  const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
  const auditBase = { ctx, op, path, requestId, agent: agentOf(request), ip: ipOf(request) }
  const decision = decideAccess(op.scope, ctx.scopes, ctx.role)

  if (decision.kind === 'forbidden') {
    if (write) await audit({ ...auditBase, status: 403 })
    return json({ success: false, error: `이 작업에는 ${decision.requiredScope} 범위가 필요합니다.`, requiredScope: decision.requiredScope }, 403, request, base)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  if (write) {
    const { data: writes, error } = await admin.rpc('record_api_key_write_hit', { p_key_id: ctx.keyId })
    if (error) console.error('[dispatch] write hit', error.code)
    if (typeof writes === 'number' && writes > WRITE_LIMIT_PER_MINUTE) {
      await audit({ ...auditBase, status: 429 })
      return json({ success: false, error: `쓰기는 분당 ${WRITE_LIMIT_PER_MINUTE}회까지입니다.` }, 429, request, { ...base, 'Retry-After': '60' })
    }
  }

  const url = request.nextUrl
  if (isDryRun(url, request.headers)) {
    if (write) await audit({ ...auditBase, status: 200, dryRun: true })
    return json({ success: true, dryRun: true, action: op.name, scope: op.scope, decision: decision.kind, params }, 200, request, base)
  }

  if (decision.kind === 'approval') {
    const { data, error } = await admin.from('api_approval_requests').insert({
      key_id: ctx.keyId, user_id: ctx.userId, action_name: op.name, required_scope: decision.requiredScope,
      method: op.kind === 'action' ? 'ACTION' : op.method, path,
      payload: { params, search: url.search, body: bodyText }, agent: auditBase.agent, request_id: requestId,
    }).select('id, expires_at').single()
    if (error || !data) {
      console.error('[dispatch] approval insert', error?.code)
      return json({ success: false, error: 'approval_unavailable' }, 503, request, base)
    }
    await audit({ ...auditBase, status: 202, approvalId: data.id })
    return json({
      success: true, status: 'PENDING', approvalId: data.id, approvalUrl: `/approvals/${data.id}`,
      requiredScope: decision.requiredScope, expiresAt: data.expires_at,
    }, 202, request, base)
  }

  const idemKey = write ? request.headers.get('idempotency-key')?.trim() ?? '' : ''
  const hash = requestHash(request.method, path, bodyText)
  if (idemKey) {
    if (idemKey.length > IDEMPOTENCY_KEY_MAX) return json({ success: false, error: 'invalid_idempotency_key' }, 400, request, base)
    const { data: prev } = await admin.from('api_idempotency').select('request_hash, status, response')
      .eq('key_id', ctx.keyId).eq('idem_key', idemKey).maybeSingle()
    if (prev) {
      if (prev.request_hash !== hash) return json({ success: false, error: 'idempotency_key_reused' }, 409, request, base)
      return json(prev.response, prev.status, request, { ...base, 'Idempotent-Replay': 'true' })
    }
  }

  const search = (() => { const s = new URLSearchParams(url.search); s.delete('dryRun'); const q = s.toString(); return q ? `?${q}` : '' })()
  const res = await runAsKeyOwner(
    { userId: ctx.userId, role: ctx.role, keyId: ctx.keyId, scopes: ctx.scopes }, requestId, op, params,
    { method: request.method, origin: url.origin, search, headers: request.headers, bodyText },
  )

  if (write) {
    await audit({ ...auditBase, status: res.status })
    const body = idemKey && res.status < 500 ? await readJson(res) : undefined
    if (body !== undefined) {
      const { error } = await admin.from('api_idempotency').insert({ key_id: ctx.keyId, idem_key: idemKey, request_hash: hash, status: res.status, response: body })
      if (error) console.error('[dispatch] idempotency insert', error.code)
    }
  }
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries({ ...corsHeaders(request), ...base })) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}
