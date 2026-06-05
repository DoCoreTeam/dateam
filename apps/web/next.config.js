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
    serverComponentsExternalPackages: ['sanitize-html'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}
module.exports = nextConfig
