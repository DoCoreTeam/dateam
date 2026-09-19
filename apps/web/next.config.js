/** @type {import('next').NextConfig} */
const { version } = require('../../package.json')

/**
 * 콘텐츠 보안 정책은 여기 없다 — `middleware.ts` 가 요청마다 만든다.
 *
 * 왜 옮겼나: 정책을 **강제**하려면 Next 가 자기 인라인 스크립트에 붙일 일회용 번호(nonce)가
 * 필요하고, 그 번호는 요청마다 달라야 한다. 설정 파일은 빌드 시점에 한 번 굳으므로
 * 여기서는 만들 수 없다. 여기 남겨 두면 응답에 정책이 둘 실려 서로를 덮는다.
 *
 * 문서가 아닌 응답(/api/*)은 미들웨어를 안 타므로 아래 headers() 에서 따로 건다.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 명함 촬영(카메라)·음성 입력(마이크)에 필요 → 자기 출처(self) 허용. geolocation은 미사용이라 차단 유지.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  // HTTPS 로만 오게 한다 — 첫 요청이 http 로 나가면 세션 쿠키가 평문으로 한 번 지나간다.
  // preload 는 안 붙인다: 프리로드 목록은 **되돌리는 데 몇 달이 걸린다**(서브도메인 전부가 묶인다).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
]

// 서버리스 크로미움을 배포본에 싣는 경로.
//
// **패키지 실물 디렉터리까지 내려간 것이 핵심이다** — 한 단계 위(`.pnpm/<패키지>@<버전>/`)를
// 통째로 훑으면 그 아래 나란히 있는 **의존성 심링크**까지 목록에 들어가고,
// Vercel 이 λ 안에 그 경로를 만들려다 ENOENT 로 **배포 자체를 죽인다**.
const SERVERLESS_CHROMIUM = [
  '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/**/*',
  '../../node_modules/.pnpm/puppeteer-core@*/node_modules/puppeteer-core/**/*',
]

// 한글 문서 파서(WASM) 를 배포본에 싣는 경로.
//
// `@rhwp/core` 는 `rhwp_bg.wasm` 을 **파일로 읽는다**(`initSync({module: readFileSync(...)})`).
// webpack 이 이 패키지를 번들하려 들면 wasm 을 자바스크립트로 파싱하다 죽는다
// (실측 2026-09-09: `/api/rfp/profile/draft` 가 500 — "Module parse failed: Unexpected character '\u0000'").
// 그래서 external 로 빼되, **그러면 배포본에 안 실리므로** 여기서 함께 지목한다.
// glob 은 위 크로미움과 같은 이유로 **패키지 실물 디렉터리까지** 내려간다.
const RHWP_WASM = [
  '../../node_modules/.pnpm/@rhwp+core@*/node_modules/@rhwp/core/**/*',
]

const nextConfig = {
  // dev 서버를 켠 채로 프로덕션 빌드를 검증할 수 있게 출력 경로를 열어 둔다.
  // (기본값은 그대로 '.next' — 환경변수를 안 주면 아무것도 달라지지 않는다)
  // 왜: `.next`가 겹쳐 dev가 깨지는 게 무서워 빌드 검증을 미루는 동안
  //   v0.7.455의 빌드 파손이 이틀간 안 보였다. NEXT_DIST_DIR=.next-check 로 확인한다.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /**
   * 이미지 최적화 창구를 닫는다.
   *
   * 왜: `/_next/image` 는 우리가 안 써도 열려 있다. 실측 2026-09-20 — 이 줄이 없으면
   * 그 주소가 실제로 이미지를 받아 해독한다("The requested resource isn't a valid image"
   * 는 **해독을 시도했다**는 뜻이다). 그런데 `next/image` 를 부르는 화면은 **0곳**이다.
   * 우리가 얻는 것이 없는데 열려 있는 창구다.
   *
   * 무엇을 막나: Next 14.2 계열에는 이미지 최적화 경로의 미인증 원격 코드 실행이 있다
   * (AVIF 입력, 고침은 15.5.24 이상이라 14 계열에는 안 온다). 15 로 올리는 것은 별도 판이고,
   * 그때까지 이 창구를 닫아 두면 그 경로가 아예 안 열린다.
   *
   * 무엇이 달라지나: 아무것도. `<img>` 는 영향 없고, 나중에 `next/image` 를 쓰면
   * 원본을 그대로 내보낸다. 가드 lib/policy/security-headers.test.ts 가 이 줄을 지킨다.
   */
  images: { unoptimized: true },

  /**
   * 워크스페이스 패키지는 타입이 붙은 채로 온다.
   *
   * 실측 2026-09-10: 여기 안 올려도 빌드는 통과했다. pnpm 이 만든 심볼릭 링크가
   * 저장소 안 실제 경로로 풀려 Next 의 기본 규칙에 걸리기 때문이다.
   * 그 통과는 우연이라 믿고 쓰지 않는다. 패키지를 나중에 발행하면 그때는
   * 진짜 node_modules 에 들어가고, 그러면 이 줄이 없는 쪽이 깨진다.
   * 새 패키지를 만들면 여기 이름을 같이 올린다.
   */
  transpilePackages: ['@ax/ai-core', '@ax/ai-gateway', '@ax/ai-providers', '@ax/ai-react'],
  /**
   * Next 15 부터 이 둘은 experimental 밖이다.
   * 옛 이름(experimental.serverComponentsExternalPackages)으로 두면 Next 가 경고만 하고
   * **값을 안 읽는다** — 그러면 크로미움·wasm 이 번들에 끌려 들어가 배포가 죽는다.
   */
  // 번들하면 안 되는 서버 전용 패키지 — **크로미움 바이너리를 다루는 둘만** 남긴다.
  //
  // ⚠️ 여기 이름을 올리는 것은 "webpack아 번들하지 마라"일 뿐, "배포본에 넣어라"가 아니다.
  //    런타임에 require 로 찾아야 하는데 배포본에 파일이 안 실리면 그 코드 경로가 통째로 죽는다.
  //    (실측 2026-08-31: `sanitize-html`이 그래서 빠졌고 **주간보고 저장이 2주간 100% 실패**했다.
  //     프로덕션 7/7 POST 500 · DB 흔적 0 · 로컬 프로덕션 빌드는 100% 성공.
  //     같은 목록의 puppeteer 계열도 함께 죽어 **회의록 PDF·이미지 내보내기가 500**이었다.)
  //
  // 그래서 규칙은 둘이다.
  //   ① 번들해도 되는 순수 JS 패키지는 **여기 올리지 않는다**(sanitize-html 이 그랬다).
  //   ② 정말 올려야 하면 아래 outputFileTracingIncludes 에 **함께** 적어 배포본 포함을 강제한다.
  // 가드: lib/ui/deploy-fragile.test.ts 가 ①②를 검사한다.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', '@rhwp/core'],

  // 위 external 패키지를 **배포본에 반드시 싣는다**(파일 추적 보강).
  //
  // 왜 추적만으로는 부족한가: Next 의 기본 추적은 `require()` 그래프를 따라간다.
  // 그런데 @sparticuz/chromium 이 실제로 여는 것은 **경로로 읽는 압축 바이너리**라
  // 어떤 require 에도 안 걸린다 — 실측: 이 선언을 빼고 빌드하면 `bin/*.br` 이 **0개**가 되고
  // executablePath() 가 실패해 회의록 PDF·이미지 내보내기가 통째로 죽는다.
  //
  // ⚠️ glob 은 **패키지 실물 디렉터리까지 내려가서** 지목한다. `<pkg>@*/**/*` 로 훑으면 안 된다.
  //    pnpm 은 `.pnpm/<pkg>@<ver>/node_modules/` 아래에 **패키지 실물과 의존성 심링크를 나란히** 둔다
  //    (`@sparticuz+chromium@149.0.0/node_modules/` = `@sparticuz/`(실물) + `tar-fs`(심링크)).
  //    넓은 glob 은 그 심링크를 가로질러 파일을 목록에 넣고, Vercel 이 λ 안에 그 경로를 만들려다
  //    **ENOENT 로 배포 자체를 죽인다.**
  //    (실측 2026-09-01~04: 프로덕션 배포 **4연속 ERROR** — `mkdir '/tmp/lambda-vhs-…/
  //     .pnpm/@sparticuz+chromium@149.0.0/node_modules/tar-fs'`. 빌드 로그는 「Compiled successfully」
  //     「305/305」까지 초록이고 실패는 그 뒤 λ 패키징 단계라 **빌드 로그만 보면 성공으로 읽힌다.**
  //     그동안 v0.7.660~686 이 프로덕션에 하나도 못 올라갔다 — 위의 주간보고 수정까지 포함해서.)
  //    심링크 안쪽 의존성(tar-fs·ws·chromium-bidi)은 기본 추적이 **실물 경로로 이미 잡는다**.
  // 가드: lib/ui/deploy-fragile.test.ts ②-b 가 넓은 glob 을 차단한다.
  outputFileTracingIncludes: {
    '/api/meeting-notes/[id]/export': SERVERLESS_CHROMIUM,
    '/api/admin/ai-chat/export-pdf': SERVERLESS_CHROMIUM,
    '/api/admin/ai-chat/analyze-export-pdf': SERVERLESS_CHROMIUM,
    // 한글 문서를 읽는 경로 — RFP 첨부 인입과 프로필 초안
    '/api/rfp/cases/[id]/files': RHWP_WASM,
    '/api/rfp/profile/draft': RHWP_WASM,
    // 견적서를 파일로 올리는 경로 — 한글(hwp·hwpx) 견적서가 흔하다.
    // 이 줄이 없으면 배포본에 wasm 이 안 실려 hwp 만 프로덕션에서 죽는다(B-2)
    '/api/crm/quotes/draft-file': RHWP_WASM,
    '/api/rfp/worker/tick': RHWP_WASM,
  },
  

  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  /**
   * 옛 주소를 살린다 — AI 채팅이 서비스(/ai)로 승격되면서 경로가 바뀌었다.
   *
   * `/ai-chat/shared/[token]` 은 **로그인 없이 열리는 공유 링크**라 이미 밖으로 나갔을 수 있다.
   * 주소를 바꾸면서 이 줄을 빼면 남의 화면이 그대로 깨진다. 쿼리스트링은 Next 가 보존한다.
   */
  async redirects() {
    return [
      /**
       *  는  의 옛 이름이다. 화면 하나가 redirect() 만 하고 있었는데,
       * Next 15 에서 그 화면을 거쳐 이동하면 라우터 내부에서 훅 개수가 어긋난다
       * (실측 2026-09-20: React #310 + 하이드레이션 실패 #418).
       * 그릴 것이 없는 화면은 그리지 않는다 — 여기서 주소만 바꾼다.
       * 미들웨어는 이보다 먼저 도므로 로그인·2단계 게이트는 그대로 걸린다.
       */
      { source: '/dashboard', destination: '/home', permanent: false },
      { source: '/ai-chat', destination: '/ai', permanent: true },
      { source: '/ai-chat/:path*', destination: '/ai/:path*', permanent: true },
      { source: '/admin/ai-chat', destination: '/ai', permanent: true },
      { source: '/admin/ai-chat/:path*', destination: '/ai/:path*', permanent: true },
    ]
  },

  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      // API 응답은 문서가 아니다. 미들웨어를 안 타므로 여기서 최소한만 건다 —
      // 브라우저가 이 응답을 문서로 열거나 프레임에 넣는 길을 막는다.
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
          },
        ],
      },
      // 폰트는 내용이 바뀌면 파일명이 바뀐다(버전 고정 산출물) → 영구 캐시.
      // `public/`은 기본이 `max-age=0`이라 두 번째 방문에도 조건부 요청이 나간다.
      // 폰트 조각이 185개라 그 왕복이 그대로 185번이 된다.
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}
module.exports = nextConfig
