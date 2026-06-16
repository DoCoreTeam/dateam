import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl

  // Public routes: API key authenticated, open documentation, or access request
  if (
    pathname.startsWith('/api/public/') ||
    pathname === '/develop' || pathname.startsWith('/develop/') ||
    pathname === '/api-access' || pathname.startsWith('/api-access/')
  ) {
    return NextResponse.next({ request })
  }

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
