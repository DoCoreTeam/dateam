// 서비스롤 키를 다루는 모듈이다 — 클라이언트 번들에 끌려 들어가면 빌드가 멈추게 한다
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { AuthError, createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Database } from '@/types/database'
import { SESSION_ONLY_COOKIE, applySessionPersistence, isSessionOnly } from '@/lib/auth/session-persistence'
import { aalFromAccessToken, blocksBeforeSecondFactor } from '@/lib/auth/mfa-level'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

// RLS 우회 전용 — 서버 사이드에서만 사용 (서비스롤 키)
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * @param opts.sessionOnly 로그인하는 그 요청에서만 넘긴다, 선호 쿠키를 막 쓴 요청이라
 *   쿠키 저장소가 아직 옛 값을 줄 수 있다. 그 밖에서는 선호 쿠키를 읽는다(lib/auth/session-persistence).
 * @param opts.allowPendingMfa 코드를 넣는 자리(/mfa)와 장치를 다루는 자리(/security)만 넘긴다.
 *   그 밖에서는 2단계를 안 지난 사람을 getUser 가 「로그인 안 함」으로 답한다.
 */
export async function createClient(opts?: { sessionOnly?: boolean; allowPendingMfa?: boolean }) {
  const cookieStore = await cookies()
  const sessionOnly = () => opts?.sessionOnly ?? isSessionOnly(cookieStore.get(SESSION_ONLY_COOKIE)?.value)

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
              cookieStore.set(
                name,
                value,
                applySessionPersistence(options, sessionOnly()) as Parameters<typeof cookieStore.set>[2],
              )
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

  if (!opts?.allowPendingMfa) gateUntilSecondFactor(client)
  return client
}

type ServerClient = ReturnType<typeof createServerClient<Database>>

/**
 * 2단계 인증을 등록한 사람은 코드까지 넣어야 서버가 사용자로 본다
 *
 * 왜 여기인가: 화면은 미들웨어가 /mfa 로 보내지만 /api 는 미들웨어를 안 탄다.
 *   창구 67곳이 각자 `auth.getUser()` 를 부르고 서버 액션도 같은 길을 쓴다.
 *   하나하나 고치면 하나를 빠뜨리므로 모두가 지나는 이 클라이언트에서 답을 바꾼다.
 * 왜 getUser 만인가: 권한 판정은 전부 getUser 의 답에서 출발한다. 사용자가 없으면 401 이 된다.
 *   표 조회는 여전히 그 사람 토큰으로 나가지만, 사용자 확인 없이 쓰는 창구는 S2 가드가 막는다.
 */
function gateUntilSecondFactor(client: ServerClient) {
  const auth = client.auth
  const verifiedGetUser = auth.getUser.bind(auth)
  auth.getUser = async (jwt?: string) => {
    const res = await verifiedGetUser(jwt)
    const user = res.data.user
    if (!user) return res
    const token = jwt ?? (await auth.getSession()).data.session?.access_token
    const verifiedFactors = (user.factors ?? []).filter((f) => f.status === 'verified').length
    if (!blocksBeforeSecondFactor({ tokenAal: aalFromAccessToken(token), verifiedFactors })) return res
    return { data: { user: null }, error: new AuthError('second factor required', 401, 'mfa_required') }
  }
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

/** 코드를 넣기 전의 사용자. /mfa 와 /security 화면만 쓴다 (그 밖에서 쓰면 2단계를 건너뛴다) */
export const getRequestUserBeforeSecondFactor = cache(async () => {
  const supabase = await createClient({ allowPendingMfa: true })
  const { data: { user } } = await supabase.auth.getUser()
  return user
})
