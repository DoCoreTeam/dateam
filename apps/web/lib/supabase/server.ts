import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Database } from '@/types/database'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

// RLS 우회 전용 — 서버 사이드에서만 사용 (서비스롤 키)
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function createClient() {
  const cookieStore = await cookies()

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieItem[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: CookieItem) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            )
          } catch {
            // Server Component에서 쿠키 쓰기는 무시 가능
          }
        },
      },
    }
  )

  // @supabase/ssr 0.5.x Server Component 세션 전파 버그 보완:
  // getSession()으로 세션을 명시 로드해두면 이후 DB 쿼리에 Authorization 헤더가 포함됨
  await client.auth.getSession()

  return client
}

/**
 * 이번 요청의 로그인 사용자 — **요청당 한 번만** 인증 서버에 묻는다.
 *
 * 왜: `supabase.auth.getUser()`는 매번 Supabase 인증 서버로 네트워크 왕복을 한다(로컬 캐시 없음).
 *   한 페이지를 그리는 데 레이아웃이 한 번, 페이지가 또 한 번, requireAdmin이 또 한 번 물어
 *   같은 답을 받으려고 왕복을 2~3회 하고 있었다.
 *   React의 `cache()`는 **요청 스코프**라 같은 요청 안에서만 답을 공유한다 —
 *   요청이 끝나면 사라지므로 사용자가 섞이거나 로그아웃이 늦게 반영될 일이 없다.
 *
 * 주의: 이건 "인증을 건너뛰는" 캐시가 아니다. 여전히 매 요청 서버에 검증을 받는다.
 *   단지 **같은 요청 안에서 같은 질문을 반복하지 않을** 뿐이다.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})
