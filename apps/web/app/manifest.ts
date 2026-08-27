import type { MetadataRoute } from 'next'
import { getBranding } from '@/lib/branding'

/**
 * 홈 화면에 설치했을 때의 이름·시작 지점.
 *
 * **정적 파일로 두지 않는다.** 앱 이름은 시스템 설정(`brand_name`)이 정하고
 * 사이드바가 그 값을 보여 준다 — 여기만 `newAX` 로 박아 두면 **설치 아이콘 이름과
 * 화면 속 이름이 서로 다른 말을 한다.** 브랜딩은 한 곳(`getBranding`)에서만 온다.
 *
 * Next 가 이 파일을 보고 `/manifest.webmanifest` 라우트와 `<link rel="manifest">` 를
 * 자동으로 만든다 — 레이아웃에 손으로 링크를 걸지 않는다.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { brandName, tagline } = await getBranding()
  return {
    name: brandName,
    short_name: brandName,
    description: tagline,
    // 로그인 상태면 홈, 아니면 미들웨어가 /login 으로 보낸다 — 설치본도 같은 규칙을 탄다
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    lang: 'ko',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/ax-logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
