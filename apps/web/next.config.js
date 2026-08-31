/** @type {import('next').NextConfig} */
const { version } = require('../../package.json')

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 명함 촬영(카메라)·음성 입력(마이크)에 필요 → 자기 출처(self) 허용. geolocation은 미사용이라 차단 유지.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
]

const nextConfig = {
  // dev 서버를 켠 채로 프로덕션 빌드를 검증할 수 있게 출력 경로를 열어 둔다.
  // (기본값은 그대로 '.next' — 환경변수를 안 주면 아무것도 달라지지 않는다)
  // 왜: `.next`가 겹쳐 dev가 깨지는 게 무서워 빌드 검증을 미루는 동안
  //   v0.7.455의 빌드 파손이 이틀간 안 보였다. NEXT_DIST_DIR=.next-check 로 확인한다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
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
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],

    // 위 external 패키지를 **배포본에 반드시 싣는다**(파일 추적 보강).
    // @sparticuz/chromium 은 압축된 크로미움 바이너리를 런타임에 풀어 쓰므로 번들은 불가능하고,
    // 추적만 믿으면 pnpm 심링크 구조에서 누락될 수 있다 — 그 누락이 이번 사고의 형태였다.
    outputFileTracingIncludes: {
      '/api/meeting-notes/[id]/export': ['../../node_modules/.pnpm/{puppeteer-core,@sparticuz+chromium}@*/**/*'],
      '/api/admin/ai-chat/export-pdf': ['../../node_modules/.pnpm/{puppeteer-core,@sparticuz+chromium}@*/**/*'],
      '/api/admin/ai-chat/analyze-export-pdf': ['../../node_modules/.pnpm/{puppeteer-core,@sparticuz+chromium}@*/**/*'],
    },
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
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
