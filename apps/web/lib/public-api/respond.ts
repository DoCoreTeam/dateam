/**
 * 공개 API 응답 봉투 SSOT (`/api/public/v1/*`)
 *
 * 왜 필요한가 (실측 v0.7.616): 봉투가 **두 벌**이었다.
 *   · products·inventory·fx·suppliers·pool-stock → `{ success, data, meta:{...} }`
 *   · accounts·contacts·deals                    → `{ success, data, nextCursor, hasMore, capped }`
 * 문서는 「모든 응답은 meta 를 따릅니다」라고 말하는데 3개가 아니었고,
 * `capped` 는 문서에 아예 없었다. 봉투를 화면마다 손으로 만들면 반드시 이렇게 갈린다.
 *
 * **하위 호환은 추가 전용으로 지킨다**(M-4). meta 로 모으되 기존 최상위 필드도 함께 내보낸다 —
 * 이미 `res.nextCursor` 를 읽던 스크립트가 있으면 그대로 돌아간다. 최상위 필드는
 * 문서에서 「이관 중」으로 표시하고, 쓰는 곳이 0이 되는 날 뺀다.
 *
 * 한도 헤더는 여기서 자동으로 실린다 — 라우트가 잊어버릴 수 있는 것은 라우트에 맡기지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { corsHeaders, rateLimitHeaders, type ApiKeyContext } from '@/lib/publicApiAuth'

export interface ListMeta {
  /** 전체 개수를 알 수 있을 때만 채운다. 모르면 넣지 않는다 — 0 으로 지어내지 않는다 */
  total?: number
  /** 다음 페이지 커서. null 이면 마지막 */
  nextCursor?: string | null
  hasMore?: boolean
  /** 필터 조회가 상한에서 잘렸는가 */
  capped?: boolean
}

interface RespondOptions {
  ctx?: ApiKeyContext
  request?: NextRequest
  status?: number
  /** 추가 응답 헤더 */
  headers?: Record<string, string>
}

/**
 * 모든 공개 API 응답이 다는 헤더 — CORS + 한도 상태.
 * 라우트가 직접 조합하지 않게 밖으로 연다(봉투를 스스로 만드는 경로가 생겨도 헤더는 같게).
 */
export function responseHeaders(opts: RespondOptions): Record<string, string> {
  return {
    ...corsHeaders(opts.request),
    ...(opts.ctx ? rateLimitHeaders(opts.ctx) : {}),
    ...(opts.headers ?? {}),
  }
}

/** 단건·객체 응답 */
export function ok<T>(data: T, opts: RespondOptions = {}): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status: opts.status ?? 200, headers: responseHeaders(opts) },
  )
}

/**
 * 목록 응답 — meta 로 모으고, 기존 최상위 필드도 함께 내보낸다.
 *
 * 최상위 필드는 **정의된 것만** 올린다. 항상 올리면 예전에 안 주던 엔드포인트가
 * 갑자기 `nextCursor: null` 을 주게 되어 그것도 계약 변경이 된다.
 */
export function okList<T>(items: T[], meta: ListMeta, opts: RespondOptions = {}): NextResponse {
  const body: Record<string, unknown> = { success: true, data: items, meta }
  if (meta.nextCursor !== undefined) body.nextCursor = meta.nextCursor
  if (meta.hasMore !== undefined) body.hasMore = meta.hasMore
  if (meta.capped !== undefined) body.capped = meta.capped
  // deals 목록만 예전부터 total 을 최상위에 줬다 — 그 계약도 그대로 지킨다
  if (meta.total !== undefined) body.total = meta.total
  return NextResponse.json(body, { status: opts.status ?? 200, headers: responseHeaders(opts) })
}

/** 실패 — 사용자가 읽을 수 있는 말로. 내부 메시지는 서버 로그에만 남긴다 */
export function fail(status: number, message: string, opts: RespondOptions = {}): NextResponse {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: responseHeaders(opts) },
  )
}

/** 못 찾음 — 존재하지 않는 id 로 상세를 열었을 때 */
export function notFound(opts: RespondOptions = {}): NextResponse {
  return fail(404, '요청한 항목을 찾을 수 없습니다.', opts)
}

/**
 * 예상 못 한 예외 — 원문은 서버 로그에, 사용자에겐 다음 조치를.
 * 라우트마다 catch 문구를 다르게 쓰면 같은 실패가 화면마다 다르게 읽힌다.
 */
export function serverError(where: string, err: unknown, opts: RespondOptions = {}): NextResponse {
  console.error(`[public/v1/${where}]`, err)
  return fail(500, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', opts)
}

/** 목록 조회 상한 — 무한 스크롤이 서버를 통째로 끌고 가지 않게 */
export const LIST_DEFAULT_LIMIT = 20
export const LIST_MAX_LIMIT = 100

/** `?limit=` 을 안전하게 읽는다 — 화면마다 상한을 다시 정하지 않는다 */
export function readLimit(request: NextRequest, fallback = LIST_DEFAULT_LIMIT): number {
  const raw = Number(request.nextUrl.searchParams.get('limit'))
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.min(Math.floor(raw), LIST_MAX_LIMIT)
}
