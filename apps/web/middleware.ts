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

/**
 * 콘텐츠 보안 정책을 **강제로** 건다 (v0.10.194)
 *
 * 왜 여기인가: 전에는 next.config 가 보고용(Report-Only)으로만 보냈다. 이유로 적어 둔 것이
 * 「nonce 를 쓰면 정적 최적화가 꺼진다」였는데, 실측해 보니 **이 앱에는 해당이 없다.**
 * 빌드 산출을 세어 보니 HTML 페이지 472개가 **전부 이미 동적**이고 정적으로 미리 그려지는
 * 페이지는 0개다(로그인 뒤 화면뿐이라 그렇다). 그래서 잃을 것이 없다.
 *
 * strict-dynamic 을 쓰는 이유: 이것을 쓰면 'self' 가 무시되고 **nonce 를 단 스크립트와
 * 그 스크립트가 불러오는 것만** 돈다. 남이 문서에 script 태그를 끼워 넣어도 nonce 가 없어서 안 돈다.
 * 화면에 손으로 적은 script 태그는 0개라(실측) 막힐 것이 없다.
 *
 * style 은 'unsafe-inline' 을 남긴다 — 리액트가 style 속성으로 값을 넣고, 스타일 주입은
 * 스크립트 주입과 위험이 다르다. 여기까지 조이려면 화면 전체를 고쳐야 하고 얻는 것이 적다.
 */
function buildCsp(nonce: string): string {
  const supabase = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin
    } catch {
      return ''
    }
  })()
  const ws = supabase.replace(/^https:/, 'wss:')

  /**
   * 개발과 운영이 갈리는 두 줄.
   *
   * - `unsafe-eval`: 개발 서버의 새로고침(React Refresh)이 eval 을 쓴다. 없으면 dev 가 죽는다.
   *   운영 번들에는 eval 이 없으므로 운영에서는 넣지 않는다.
   * - `upgrade-insecure-requests`: 운영은 전부 https 라 맞는 말이지만, 로컬은 http 라
   *   자기 자신을 https 로 올리려다 실패한다(실측 net::ERR_SSL_PROTOCOL_ERROR).
   */
  const isProd = process.env.NODE_ENV === 'production'
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${ws}`.trim(),
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  /**
   * 이미지 최적화 창구를 닫는다 — 세션을 보기 전에, 맨 먼저.
   *
   * 왜: `/_next/image` 는 **우리가 안 써도 열려 있다.** `next/image` 를 부르는 화면은 0곳인데
   * 실측 2026-09-20 그 주소는 이미지를 실제로 받아 해독했다. next.config 의
   * `images.unoptimized` 는 컴포넌트 쪽만 바꾸고 이 주소는 그대로 열어 둔다(실측으로 확인).
   *
   * 무엇을 막나: Next 14.2 계열의 이미지 최적화 경로 미인증 원격 코드 실행.
   * 고침이 15.5.24 이상에만 있어 14 계열에는 안 온다. 15 로 올릴 때까지 여기서 닫는다.
   *
   * 값이 없는 창구는 닫는다 — 이것이 규칙이다(LOOP.md 7절).
   * `next/image` 를 쓰기로 하면 이 블록을 지우고 Next 를 먼저 올린다.
   */
  if (pathname === '/_next/image') {
    return new NextResponse(null, { status: 404 })
  }

  /**
   * 요청마다 새 일회용 번호를 만들어 **요청 헤더에** 싣는다.
   * Next 는 요청의 Content-Security-Policy 헤더에서 nonce 를 읽어 자기 스크립트에 붙인다 —
   * 응답에만 달면 Next 가 못 읽고 부트스트랩 스크립트가 통째로 막힌다.
   */
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  /** 어느 길로 나가든 정책이 실리게 한다. 빠진 응답 하나가 곧 구멍이다. */
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp)
    return res
  }

  // 공개 경로는 user를 보지 않고 통과한다 — 판정에 user가 쓰이지 않으므로 결과가 동일하고,
  // getUser()(Supabase 인증 서버 왕복 ~600ms)를 통째로 아낀다.
  // (예전엔 이 분기가 getUser() **뒤**에 있어 공개 API·개발자센터도 매번 통행료를 냈다)
  if (isPublicPath(pathname)) return withCsp(NextResponse.next({ request }))

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
    return withCsp(NextResponse.redirect(url))
  }

  // 로그인 후 /login 접근 → /dashboard
  // (/dashboard는 (member) 아래라, api_user면 그 레이아웃이 /api-keys로 되돌린다 — 목적지 동일)
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return withCsp(NextResponse.redirect(url))
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

  return withCsp(supabaseResponse)
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
    // 위 줄이 일부러 빼 둔 경로다. 닫으려면 태워야 하므로 **이 한 줄만** 따로 더한다.
    // 정상 트래픽이 0 이라 늘어나는 비용도 0 이다.
    '/_next/image',
  ],
}
