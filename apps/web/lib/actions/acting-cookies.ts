/**
 * 키 주인 세션을 앱 인증 쿠키로 (P0159 I01)
 *
 * 견적서 내보내기는 서버 안 머리 없는 브라우저가 견적 화면을 연다(lib/quote-export)
 * 웹에서 부르면 요청한 사람의 쿠키를 그대로 심으면 되지만, 공개 API 관문으로 부르면 쿠키가 없다
 * 그래서 관문이 연 문맥(acting-session)의 키 주인 세션을 @supabase/ssr 이 읽는 쿠키 모양으로 바꾼다
 *
 * 지키는 것
 *   문맥 밖이면 요청 쿠키를 그대로 돌려준다, 웹 경로는 바뀌지 않는다
 *   문맥 안이면 요청 쿠키를 버리고 키 주인 쿠키만 돌려준다, 부른 쪽이 섞어 넣은 쿠키로 남의 화면을 열지 못한다
 *   토큰 값은 돌려주는 쿠키에만 실린다, 찍지도 오류 문구에 싣지도 않는다
 *   어느 출처에 심을지는 여기서 정하지 않는다, render-document 가 믿은 출처(url: origin)에만 심는다
 */

import { createChunks, stringToBase64URL } from '@supabase/ssr'
import type { ActingSession } from './acting-session.ts'

export interface PlainCookie {
  name: string
  value: string
}

/** @supabase/ssr 기본 쿠키 인코딩이 붙이는 접두 (cookieEncoding base64url) */
export const SSR_BASE64_PREFIX = 'base64-'

/** supabase-js 기본 저장 키와 같은 셈, 프로젝트 주소의 첫 마디 */
export function authCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

/** 키 주인 세션을 쿠키 조각으로. 화면의 미들웨어와 서버 클라이언트가 이 쿠키로 그 사람을 본다 */
export function sessionAuthCookies(supabaseUrl: string, session: ActingSession, nowSec: number): PlainCookie[] {
  const stored = {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: 'bearer',
    expires_at: session.expiresAt,
    expires_in: Math.max(0, session.expiresAt - nowSec),
  }
  const value = SSR_BASE64_PREFIX + stringToBase64URL(JSON.stringify(stored))
  return createChunks(authCookieName(supabaseUrl), value).map((c) => ({ name: c.name, value: c.value }))
}

export type ExportCookieResult =
  | { ok: true; cookies: PlainCookie[] }
  | { ok: false; reason: 'second_factor' }

export interface ExportCookieInput {
  /** 요청에 실려 온 쿠키, 문맥 밖에서만 쓴다 */
  requestCookies: PlainCookie[]
  /** 관문이 연 키 주인 문맥의 세션, 없으면 웹 경로 */
  acting?: { session: ActingSession }
  /** 키 주인의 확인된 2단계 장치 수, 문맥 안에서만 본다 */
  verifiedFactors?: number
  supabaseUrl: string
  nowSec: number
}

/**
 * 머리 없는 브라우저에 심을 쿠키
 *
 * 2단계 장치가 있는 키 주인은 거절한다, 키로 만든 세션은 aal1 이라 화면이 /mfa 로 보내고
 * 브라우저는 종이를 못 찾은 채 60초를 기다린다
 */
export function exportCookiesFor(input: ExportCookieInput): ExportCookieResult {
  if (!input.acting) return { ok: true, cookies: input.requestCookies }
  if ((input.verifiedFactors ?? 0) > 0) return { ok: false, reason: 'second_factor' }
  return { ok: true, cookies: sessionAuthCookies(input.supabaseUrl, input.acting.session, input.nowSec) }
}
