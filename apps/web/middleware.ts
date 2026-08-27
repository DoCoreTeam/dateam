import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }

/**
 * 세션 게이트를 타지 않는 경로 — 로그인 여부와 **무관하게** 통과한다.
 *
 * /api/public/*      : API 키로 인증한다(lib/publicApiAuth).
 * /api/ci/internal/* : 서비스 토큰(CI_WORKER_TOKEN). 크론·큐가 부르므로 쿠키가 없다.
 * /sw.js·/manifest.webmanifest·/offline : 오프라인 대비 3종. **데이터가 한 글자도 없다.**
 *   막으면 서비스 워커 등록이 302 를 받아 실패하고, /offline 자리에 로그인 화면이
 *   캐시된다 — 연결이 끊겼을 때 '연결이 없다' 대신 로그인 화면을 보게 된다.
 *
 * 지금은 matcher가 /api/*를 아예 태우지 않으므로 앞의 두 줄은 실행되지 않는다.
 * 그래도 남겨 둔다 — matcher를 되돌리는 순간 공개 API가 세션 게이트에 막히기 때문이다.
 *
 * ⚠️ v0.7.617: `/develop`·`/api-access`가 이 목록에서 **빠졌다.**
 *   공개 API 는 외부에 파는 것이 아니라 **사내 자동화용**이라는 결정에 따라
 *   개발자센터를 로그인 뒤로 옮겼다(사용자 지시 2026-08-27).
 *   그래서 이제 셸 밖 공개 화면은 `/login`·`/change-password` 둘뿐이다 —
 *   "공개 화면 4개" 를 전제로 한 주석·코드가 있으면 그 전제가 깨진다
 *   (`lib/auth/api-user-gate.ts` 는 함께 고쳤다).
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/public/') ||
    pathname.startsWith('/api/ci/internal/') ||
    pathname === '/sw.js' || pathname === '/manifest.webmanifest' || pathname === '/offline'
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 공개 경로는 user를 보지 않고 통과한다 — 판정에 user가 쓰이지 않으므로 결과가 동일하고,
  // getUser()(Supabase 인증 서버 왕복 ~600ms)를 통째로 아낀다.
  // (예전엔 이 분기가 getUser() **뒤**에 있어 공개 API·개발자센터도 매번 통행료를 냈다)
  if (isPublicPath(pathname)) return NextResponse.next({ request })

  /**
   * 지금 어느 화면인지를 서버 컴포넌트에 알려 준다.
   *
   * 왜 필요한가 (실측 v0.7.617): `/api-keys`는 `(member)` 아래에 있고 그 레이아웃이
   * api_user를 **`/api-keys`로** 되돌린다 — 즉 api_user가 자기 집에 들어가려 할 때마다
   * 같은 곳으로 다시 보내는 **무한 리다이렉트**였다. 승인된 api_user 2명이 발급받은 키를
   * 한 번도 쓰지 못한 것이 그 결과다.
   * 서버 컴포넌트는 pathname을 직접 못 읽으므로, 여기서 한 줄로 실어 보낸다.
   * (`lib/auth/api-user-gate.ts`가 이 값을 읽어 "이미 목적지면 되돌리지 않는다"를 판정한다)
   */
  request.headers.set('x-pathname', pathname)

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

  // 로그인 후 /login 접근 → /dashboard
  // (/dashboard는 (member) 아래라, api_user면 그 레이아웃이 /api-keys로 되돌린다 — 목적지 동일)
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // api_user 차단은 여기서 하지 않는다 — 레이아웃이 한다(lib/auth/api-user-gate.ts).
  //
  // 왜 옮겼나: 판정에 필요한 profiles.role을 여기서 **따로** 조회하느라
  //   페이지 요청 하나당 236ms가 들었다(실측 — 같은 /kpi 페이지로 조회 유무만 바꿔 비교).
  //   정작 (member)·admin·(ci) 레이아웃은 렌더에 필요한 name·theme_preference를 가져오는
  //   그 한 번의 조회에서 **role을 이미 함께 읽고 있었다.** 게이트를 레이아웃으로 내리면
  //   추가 왕복이 0회가 된다.
  //
  // 구멍이 없는지: 화면 페이지 81개를 전수로 확인했다.
  //   76개는 세 레이아웃이 덮고, 4개(/api-keys·/change-password·/develop·/api-access)는
  //   api_user에게 원래 허용된 곳이며(v0.7.617부터 뒤의 둘도 로그인이 필요하지만,
  //   api_user에게 허용된다는 사실은 그대로다), 나머지 1개(app/page.tsx)는 redirect('/home')뿐이라
  //   (member) 레이아웃으로 들어가 막힌다.
  //   가드: lib/auth/api-user-gate.test.ts가 새 페이지가 이 밖으로 새면 실패한다.

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
