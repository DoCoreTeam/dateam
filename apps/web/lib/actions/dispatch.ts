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
import { agentOf, ipOf } from '@/lib/public-api/api-audit'
import { currentActing, issueActingGrant, runActing } from './acting-session'
import { MODULES, MOUNTED, type MountedOp } from './generated/table'
import {
  IDEMPOTENCY_KEY_MAX, WRITE_LIMIT_PER_MINUTE, actionArgs, decideAccess, internalPath, isDryRun, isWrite,
  isHumanOnly, matchMount, mayDecideApproval, publicPathOf, requestHash,
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

  const write = isWrite(op.scope, request.method)
  const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
  const auditBase = { ctx, op, path, requestId, agent: agentOf(request.headers), ip: ipOf(request.headers) }
  if (isHumanOnly(op.name)) {
    await audit({ ...auditBase, status: 403 })
    return json({ success: false, error: '이 작업은 사람이 화면에서 합니다.', code: 'human_only' }, 403, request, base)
  }
  const decision = decideAccess(op.scope, ctx.scopes, ctx.role, request.method)

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
      payload: { params, search: url.search, body: bodyText, ip: auditBase.ip }, agent: auditBase.agent, request_id: requestId,
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
    if (idemKey.length > IDEMPOTENCY_KEY_MAX) {
      await audit({ ...auditBase, status: 400 })
      return json({ success: false, error: 'invalid_idempotency_key' }, 400, request, base)
    }
    const { data: prev } = await admin.from('api_idempotency').select('request_hash, status, response')
      .eq('key_id', ctx.keyId).eq('idem_key', idemKey).maybeSingle()
    if (prev) {
      // 거절과 재생도 쓰기 시도라 감사에 남긴다 (P0162 I02)
      if (prev.request_hash !== hash) {
        await audit({ ...auditBase, status: 409 })
        return json({ success: false, error: 'idempotency_key_reused' }, 409, request, base)
      }
      await audit({ ...auditBase, status: prev.status })
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

export type ApprovalOutcome =
  | { ok: true; status: 'APPROVED' | 'REJECTED' | 'FAILED'; resultStatus?: number }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_pending' | 'expired' | 'not_mounted' }

/**
 * 승인 요청 결정 (P0158 I08)
 * 결정은 키 소유자 본인 또는 관리자만, 만료된 요청은 EXPIRED 로 바꾸고 실행하지 않는다
 * 먼저 PENDING 인 줄만 상태를 바꿔 집고(둘이 동시에 눌러도 한 번만 실행), 그다음 같은 처리 함수를 키 소유자 문맥에서 부른다
 */
export async function decideApproval(
  id: string,
  decider: { userId: string; role: string },
  decision: 'approve' | 'reject',
  origin: string,
): Promise<ApprovalOutcome> {
  // 키 소유자 문맥 안(관문을 거친 호출)이면 읽기 전에 끊는다, 키가 자기 요청을 스스로 통과시키지 못하게
  const viaKey = currentActing() !== undefined
  if (viaKey) return { ok: false, code: 'forbidden' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('api_approval_requests')
    .select('id, key_id, user_id, action_name, required_scope, method, payload, status, expires_at, request_id, agent')
    .eq('id', id).maybeSingle()
  if (!row) return { ok: false, code: 'not_found' }
  if (!mayDecideApproval({ viaKey, deciderId: decider.userId, ownerId: row.user_id, deciderRole: decider.role })) {
    return { ok: false, code: 'forbidden' }
  }
  if (row.status !== 'PENDING') return { ok: false, code: 'not_pending' }
  const now = new Date().toISOString()
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await admin.from('api_approval_requests').update({ status: 'EXPIRED' }).eq('id', id).eq('status', 'PENDING')
    return { ok: false, code: 'expired' }
  }
  const next = decision === 'approve' ? 'APPROVED' : 'REJECTED'
  const { data: claimed } = await admin.from('api_approval_requests')
    .update({ status: next, decided_by: decider.userId, decided_at: now })
    .eq('id', id).eq('status', 'PENDING').gt('expires_at', now).select('id').maybeSingle()
  if (!claimed) return { ok: false, code: 'not_pending' }
  if (next === 'REJECTED') return { ok: true, status: 'REJECTED' }

  const op = findMounted(row.action_name)
  if (!op) {
    await admin.from('api_approval_requests').update({ status: 'FAILED', result: { error: 'not_mounted' } }).eq('id', id)
    return { ok: false, code: 'not_mounted' }
  }
  const { data: owner } = await admin.from('profiles').select('role').eq('id', row.user_id).maybeSingle()
  const { data: key } = await admin.from('api_keys').select('scopes').eq('id', row.key_id).maybeSingle()
  const scopes = [...new Set([...(key?.scopes ?? ['read']), row.required_scope])]
  const payload = (row.payload ?? {}) as { params?: Record<string, string>; search?: string; body?: string; ip?: string | null }
  const search = (() => { const s = new URLSearchParams(payload.search ?? ''); s.delete('dryRun'); const q = s.toString(); return q ? `?${q}` : '' })()
  const res = await runAsKeyOwner(
    { userId: row.user_id, role: owner?.role ?? 'member', keyId: row.key_id, scopes },
    row.request_id ?? crypto.randomUUID(), op, payload.params ?? {},
    { method: op.method, origin, search, headers: new Headers({ 'content-type': 'application/json' }), bodyText: payload.body ?? '' },
  )
  const body = await readJson(res)
  const failed = res.status >= 500
  await admin.from('api_approval_requests')
    .update({ status: failed ? 'FAILED' : 'APPROVED', result: { status: res.status, body: body ?? null } }).eq('id', id)
  // 실행 감사에는 요청 때의 에이전트와 ip 를 싣는다, 결정한 사람의 것이 아니다 (P0162 I02)
  await admin.from('api_write_audit').insert({
    key_id: row.key_id, user_id: row.user_id, request_id: row.request_id, agent: row.agent ?? null, ip: payload.ip ?? null, action_name: op.name,
    method: op.kind === 'action' ? 'ACTION' : op.method, path: op.mount, status: res.status, approval_id: id,
  })
  return { ok: true, status: failed ? 'FAILED' : 'APPROVED', resultStatus: res.status }
}
