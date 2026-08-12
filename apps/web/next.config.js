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
  experimental: {
    // 번들하면 안 되는 서버 전용 패키지. @sparticuz/chromium은 압축된 크로미움 바이너리를
    // 런타임에 풀어 쓰는데, webpack이 번들해버리면 그 파일들이 배포본에 안 실려
    // executablePath()가 실패한다 → 회의록 PDF·이미지 내보내기가 통째로 죽는다.
    serverComponentsExternalPackages: ['sanitize-html', 'puppeteer-core', '@sparticuz/chromium'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}
module.exports = nextConfig
