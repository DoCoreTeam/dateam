import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

/**
 * 세션 게이트를 타지 않는 경로 — 로그인 여부와 **무관하게** 통과한다.
 *
 * /api/public/*      : API 키로 인증한다(lib/publicApiAuth).
 * /api/ci/internal/* : 서비스 토큰(CI_WORKER_TOKEN). 크론·큐가 부르므로 쿠키가 없다.
 * /develop·/api-access : 로그인 없이 외부인이 보는 화면.
 *
 * 지금은 matcher가 /api/*를 아예 태우지 않으므로 앞의 두 줄은 실행되지 않는다.
 * 그래도 남겨 둔다 — matcher를 되돌리는 순간 공개 API가 세션 게이트에 막히기 때문이다.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/public/') ||
    pathname.startsWith('/api/ci/internal/') ||
    pathname === '/develop' || pathname.startsWith('/develop/') ||
    pathname === '/api-access' || pathname.startsWith('/api-access/')
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 공개 경로는 user를 보지 않고 통과한다 — 판정에 user가 쓰이지 않으므로 결과가 동일하고,
  // getUser()(Supabase 인증 서버 왕복 ~600ms)를 통째로 아낀다.
  // (예전엔 이 분기가 getUser() **뒤**에 있어 공개 API·개발자센터도 매번 통행료를 냈다)
  if (isPublicPath(pathname)) return NextResponse.next({ request })

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieItem[]) {
          cookiesToSet.forEach(({ name, value }: CookieItem) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }: CookieItem) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 비로그인 → /login 리다이렉트
  if (!user && pathname !== '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 로그인 후 /login 접근 → /dashboard (단, api_user는 /api-keys로)
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // api_user 권한 제한 — 내부 페이지 접근 차단.
  // 최적화(가역·무회귀): role 조회는 "api_user를 비허용 경로에서 리다이렉트"할 때만 필요하다.
  // 현재 경로가 이미 허용 경로면 role과 무관하게 결과가 동일(리다이렉트 없음)하므로 DB 조회를 건너뛴다.
  // → api_user 트래픽(주로 /api-keys 상주)과 /login·/develop·/api-access 접근은 매요청 profiles 조회 제거.
  // 비허용 경로에서만 기존대로 profiles.role 조회 후 차단(인증/차단 동작 100% 보존).
  if (user) {
    const allowedPrefixes = ['/api-keys', '/change-password', '/develop', '/api-access', '/login']
    const isAllowed = allowedPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (!isAllowed) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      const userRole = (profile as { role?: string } | null)?.role
      if (userRole === 'api_user') {
        const url = request.nextUrl.clone()
        url.pathname = '/api-keys'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  // /api/*는 제외한다 — **화면 라우트만** 이 게이트를 탄다.
  //
  // 왜: API 라우트는 전부 자기 인증을 한다(201개 전수 확인 — 공용 헬퍼 150 ·
  //   라우트 내 getUser+401 45 · 서비스 토큰 3 · 나머지 3은 의도적 공개이거나
  //   데이터 함수 안에서 RLS로 막는다). 미들웨어가 유일한 방어선인 API는 0개였다.
  //   그런데 모든 API 호출이 여기서 Supabase 인증 서버 왕복(getUser ~600ms) +
  //   profiles.role 조회를 **중복으로** 치르고 있었다. 라우트가 requireXxxApi로
  //   똑같은 검사를 한 번 더 하므로 순수 낭비다.
  //   (실측: /api/work/sync/version은 모든 화면에서 호출되는데 ~1.5초였고,
  //    그중 인증 왕복이 4회 — 미들웨어 2 + 라우트 2 — 였다)
  //
  // 세션 갱신도 문제없다: lib/supabase/server.ts의 createClient()가 Route Handler에서
  // 쿠키를 쓸 수 있어(cookieStore.set) 라우트 스스로 토큰을 갱신한다.
  //
  // 바뀌는 것: 비로그인 API 호출의 응답이 '302 → /login'에서 **401 JSON**이 된다.
  // API로는 이쪽이 맞고, 302를 기대하던 호출부는 없다(전수 확인).
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
