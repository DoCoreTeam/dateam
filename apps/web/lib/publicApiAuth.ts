/**
 * 공개 API 인증·한도 SSOT (`/api/public/v1/*`)
 *
 * 이 API 는 **사내 자동화용**이다(사용자 결정 2026-08-27). 외부에 파는 API 가 아니다.
 * 그래서 권한 모델을 새로 만들지 않는다 — **키는 그 키를 만든 사용자의 권한을 그대로 상속한다.**
 * 내부 화면에서 볼 수 있는 것 = API 로 볼 수 있는 것. 신원이 쿠키로 오느냐 키로 오느냐만 다르다.
 * 권한 모델이 둘이 되면 언젠가 한쪽만 조여지고, 느슨한 쪽이 문이 된다.
 *
 * v0.7.617 에서 고친 것 (실측 근거는 docs/2026-08-27-devcenter-audit/00-REPORT.md):
 *   ① `request_count` 가 **영원히 1** 이었다 — select 에 그 컬럼이 없는데 `(x ?? 0) + 1` 로 덮어썼다.
 *      운영 DB 최댓값이 정확히 1 이었던 것이 증거다. 이제 DB 함수가 원자적으로 센다.
 *   ② 문서가 약속한 분당 한도·429·Retry-After 를 세는 코드가 **어디에도 없었다.** 이제 실제로 막는다.
 *   ③ 키 소유자의 역할·삭제 여부를 보지 않았다. 퇴사로 계정이 지워져도 키는 계속 살아 있었다.
 *   ④ CORS 가 `*` 였다 — 남의 사이트가 사용자의 브라우저에서 우리 API 를 부를 수 있었다.
 *
 * 기록은 **기다린다.** Next 14 의 fire-and-forget 은 응답과 함께 사라져 조용히 0건이 된다
 * (예전 코드가 정확히 그랬다). DB 왕복 1회로 기록·한도·잔량을 한꺼번에 받아 온다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashApiKey } from '@/lib/apiKey'

/** 키 소유자의 호스트 역할 — profiles.role 을 그대로 물려받는다 */
export type ApiKeyRole = 'admin' | 'member' | 'api_user'

export interface ApiKeyUsage {
  /** 이번 분에 몇 번째 호출인가 (이 호출 포함) */
  thisMinute: number
  /** 이 키의 누적 호출 수 */
  total: number
  /** 이번 분 창이 끝나는 시각 — Retry-After · X-RateLimit-Reset 의 근거 */
  resetAt: Date
}

export interface ApiKeyContext {
  /** profiles.id — 이 키를 만든 사람 */
  userId: string
  /** 그 사람의 역할. 내부 API 와 같은 게이트를 걸 때 쓴다 */
  role: ApiKeyRole
  keyId: string
  keyName: string
  rateLimitPerMinute: number
  usage: ApiKeyUsage
}

export type PublicApiAuth = { ctx: ApiKeyContext } | { error: NextResponse }

/** 이 파일 바깥에서 `'error' in auth` 를 매번 쓰지 않게 */
export function isAuthError(auth: PublicApiAuth): auth is { error: NextResponse } {
  return 'error' in auth
}

const KEY_PREFIX = 'ax_live_'
const DEFAULT_RATE_LIMIT = 60

/* ────────────────────────────────────────────────────────────────────────────
 * CORS — 사내용이라 브라우저 직접 호출은 우리 화면만 허용한다
 *
 * 예전엔 `*` 였다. 그러면 아무 사이트나 사용자의 브라우저에서 우리 API 를 부를 수 있고,
 * 문서가 JavaScript 예제를 주고 있으니 키를 브라우저에 두라는 신호가 된다.
 * 같은 출처(개발자센터의 「직접 실행」)는 애초에 CORS 를 타지 않으므로 아무것도 잃지 않는다.
 * ──────────────────────────────────────────────────────────────────────────── */
export function corsHeaders(request?: NextRequest): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    Vary: 'Origin',
  }
  const origin = request?.headers.get('origin')
  if (origin && request && origin === request.nextUrl.origin) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

export function optionsResponse(request?: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

/** 매 응답에 실리는 한도 상태 — 문서가 약속한 헤더를 실제로 보낸다 */
export function rateLimitHeaders(ctx: ApiKeyContext): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(ctx.rateLimitPerMinute),
    'X-RateLimit-Remaining': String(Math.max(0, ctx.rateLimitPerMinute - ctx.usage.thisMinute)),
    'X-RateLimit-Reset': String(Math.floor(ctx.usage.resetAt.getTime() / 1000)),
  }
}

function fail(
  status: number,
  message: string,
  request?: NextRequest,
  extra?: Record<string, string>,
): { error: NextResponse } {
  return {
    error: NextResponse.json(
      { success: false, error: message },
      { status, headers: { ...corsHeaders(request), ...(extra ?? {}) } },
    ),
  }
}

/**
 * 이 요청이 공개 API 를 쓸 수 있는지 판정하고, 호출 1건을 기록한다.
 *
 * 판정 순서가 곧 방어선이다:
 *   1) 키 형식 → 2) 키 존재 → 3) 폐기 여부 → 4) **소유자 계정 상태** → 5) 한도
 * 4를 빼면 퇴사해 계정이 지워진 사람의 키가 영원히 산다(예전에 그랬다).
 */
export async function authenticatePublicApi(request: NextRequest): Promise<PublicApiAuth> {
  const authHeader = request.headers.get('x-api-key') ?? request.headers.get('authorization')
  const rawKey = authHeader
    ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader).trim()
    : null

  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
    return fail(401, 'API 키가 없거나 형식이 올바르지 않습니다. X-API-Key 헤더로 보내 주세요.', request)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data: key, error } = await admin
    .from('api_keys')
    .select('id, user_id, name, revoked_at, rate_limit_per_minute')
    .eq('key_hash', hashApiKey(rawKey))
    .maybeSingle()

  if (error || !key) {
    return fail(401, '유효하지 않은 API 키입니다.', request)
  }
  if (key.revoked_at) {
    return fail(403, '폐기된 API 키입니다. 새 키를 발급받아 주세요.', request)
  }

  // 소유자 계정이 살아 있는가 — 키의 권한은 여기서 나온다
  const { data: profile } = await admin
    .from('profiles')
    .select('role, deleted_at')
    .eq('id', key.user_id)
    .maybeSingle()

  if (!profile || profile.deleted_at) {
    return fail(403, '이 키를 발급한 계정을 사용할 수 없습니다. 관리자에게 문의해 주세요.', request)
  }

  const rateLimitPerMinute = key.rate_limit_per_minute ?? DEFAULT_RATE_LIMIT

  // 기록과 한도 판정을 한 왕복에서 — 읽고 더해서 쓰면 동시 요청에서 틀린다(마이그 223)
  const { data: hitRows, error: hitError } = await admin.rpc('record_api_key_hit', {
    p_key_id: key.id,
  })

  // 기록이 실패해도 요청은 통과시킨다 — 계측이 사용자의 일을 막으면 안 된다.
  // 다만 한도를 못 세므로 이번 요청은 한도 밖으로 둔다(막지 않는다).
  const hit = Array.isArray(hitRows) ? hitRows[0] : hitRows
  const usage: ApiKeyUsage = {
    thisMinute: hit?.hits_this_minute ?? 0,
    total: hit?.total_hits ?? 0,
    resetAt: hit?.minute_start
      ? new Date(new Date(hit.minute_start).getTime() + 60_000)
      : new Date(Date.now() + 60_000),
  }
  if (hitError) console.error('[publicApiAuth] record_api_key_hit', hitError)

  const ctx: ApiKeyContext = {
    userId: key.user_id,
    role: (profile.role ?? 'member') as ApiKeyRole,
    keyId: key.id,
    keyName: key.name ?? '',
    rateLimitPerMinute,
    usage,
  }

  if (usage.thisMinute > rateLimitPerMinute) {
    const retryAfter = Math.max(1, Math.ceil((usage.resetAt.getTime() - Date.now()) / 1000))
    return fail(
      429,
      `분당 요청 한도(${rateLimitPerMinute}회)를 넘었습니다. ${retryAfter}초 후 다시 시도해 주세요.`,
      request,
      { ...rateLimitHeaders(ctx), 'Retry-After': String(retryAfter) },
    )
  }

  return { ctx }
}

/**
 * 내부 API 와 같은 관리자 게이트 — `lib/auth/requireAdminApi` 의 키 버전.
 *
 * 구 CRM(accounts·contacts·deals)의 내부 라우트가 `requireAdminApi` 를 쓰므로
 * 공개 라우트도 같은 선을 지킨다. 여기서 느슨해지면 화면보다 API 가 더 많이 할 수 있게 된다.
 */
export function requireAdminKey(ctx: ApiKeyContext, request?: NextRequest): NextResponse | null {
  if (ctx.role === 'admin') return null
  return NextResponse.json(
    { success: false, error: '이 작업은 관리자 키로만 할 수 있습니다.' },
    { status: 403, headers: { ...corsHeaders(request), ...rateLimitHeaders(ctx) } },
  )
}

/**
 * 구 CRM 레코드를 수정·삭제할 수 있는가.
 *
 * 근거는 우리가 지어낸 규칙이 아니라 **DB 의 RLS 정책**이다(실측):
 *   accounts/contacts/deals `*_update_own` · `*_delete_own`
 *     = `auth.uid() = user_id  OR  profiles.role = 'admin'`
 * 공개 API 는 서비스 롤로 돌아 RLS 를 우회하므로, 같은 판정을 앱에서 다시 해야 한다.
 * (예전엔 이 검사가 0건이라 키 하나로 전원의 레코드를 고치고 지울 수 있었다)
 */
export function canMutateOwnedRow(ctx: ApiKeyContext, rowUserId: string | null | undefined): boolean {
  return ctx.role === 'admin' || (!!rowUserId && rowUserId === ctx.userId)
}

export function forbiddenNotOwner(ctx: ApiKeyContext, request?: NextRequest): NextResponse {
  return NextResponse.json(
    { success: false, error: '본인이 만든 항목이거나 관리자만 수정·삭제할 수 있습니다.' },
    { status: 403, headers: { ...corsHeaders(request), ...rateLimitHeaders(ctx) } },
  )
}
