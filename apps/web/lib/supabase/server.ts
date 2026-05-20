import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
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
