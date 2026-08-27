import type { Metadata } from 'next'
import './globals.css'
import { getBranding } from '@/lib/branding'
import { getEffectiveTheme } from '@/lib/theme'
import ServiceWorkerBoot from '@/components/ui/ServiceWorkerBoot'

// 브라우저 탭 타이틀 = 시스템 설정(brand_name). 하드코딩 제거.
export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await getBranding()
  return {
    title: brandName,
    description: '팀 루틴·KPI·주간보고 통합 관리',
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 개인 선택 테마 우선(없으면 전역 디폴트)을 SSR 시 주입 → 첫 페인트부터 정확(FOUC 없음)
  const theme = await getEffectiveTheme()
  return (
    <html lang="ko" data-theme={theme}>
      <head>
        {/* 폰트는 여기서 <link>로 건다 — globals.css의 `@import`는 그 파일을 받아
            파싱한 뒤에야 발견돼 직렬로 이어졌다. <link>는 HTML을 읽는 순간 발견돼
            globals.css와 **병렬로** 내려온다. 같은 출처라 DNS·TLS 왕복도 없다.
            (근거: docs/2026-08-16-performance-audit/PLAN.md §2-3) */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        {/* 네트워크가 없어도 화면이 뜨게 한다. 프로덕션에서만 켠다 — 이유는 컴포넌트 주석 참조 */}
        <ServiceWorkerBoot />
        {children}
      </body>
    </html>
  )
}
