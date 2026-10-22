import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { SESSION_ONLY_COOKIE, applySessionPersistence, isSessionOnly } from '@/lib/auth/session-persistence'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

/**
 * 쿠키 읽기·쓰기를 직접 건다.
 * 기본 구현은 토큰을 갱신할 때마다 400일짜리로 써서 「로그인 상태 유지」를 끈 세션도 남게 만든다.
 * 서버 렌더 중에는 document 가 없으므로 빈 값을 돌려주고 쓰지 않는다.
 */
function readCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined') return []
  return parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? '' }))
}

function writeCookies(cookiesToSet: CookieItem[]): void {
  if (typeof document === 'undefined') return
  const sessionOnly = isSessionOnly(readCookies().find((c) => c.name === SESSION_ONLY_COOKIE)?.value)
  cookiesToSet.forEach(({ name, value, options }) => {
    document.cookie = serializeCookieHeader(
      name,
      value,
      (applySessionPersistence(options, sessionOnly) ?? {}) as Parameters<typeof serializeCookieHeader>[2],
    )
  })
}

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: readCookies, setAll: writeCookies } }
  )
}
