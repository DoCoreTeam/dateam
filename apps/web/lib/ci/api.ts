// lib/ci/api.ts — API 응답 헬퍼 (서버 전용)
// 전 엔드포인트가 같은 봉투와 에러 코드를 쓴다. 라우트마다 형태를 다르게 만들지 않는다.

import { NextResponse } from 'next/server'
import { CI_ERROR_STATUS, type ApiMeta, type CiErrorCode } from './contracts.ts'

export function ok<T>(data: T, meta?: ApiMeta): NextResponse {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) })
}

export function fail(code: CiErrorCode, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, ...(details ? { details } : {}) } },
    { status: CI_ERROR_STATUS[code] },
  )
}

/**
 * 예기치 못한 예외를 봉투에 담는다.
 * 내부 메시지를 그대로 노출하지 않되, 침묵하지도 않는다 — 코드는 항상 준다.
 */
export function failUnexpected(e: unknown): NextResponse {
  const detail = e instanceof Error ? e.message : String(e)
  // 서버 로그에는 남긴다(클라이언트 응답에는 넣지 않는다)
  console.error('[ci-api]', detail)
  return fail('INTERNAL', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
}

/** 커서 페이지네이션 파라미터. limit는 1~100으로 강제한다. */
export function readPaging(url: URL): { limit: number; cursor: string | null } {
  const raw = Number(url.searchParams.get('limit') ?? 30)
  const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.trunc(raw))) : 30
  return { limit, cursor: url.searchParams.get('cursor') }
}
