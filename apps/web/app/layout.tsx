import type { Metadata } from 'next'
import './globals.css'
import { getBranding } from '@/lib/branding'
import { getActiveTheme } from '@/lib/theme'

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
  // 전역 테마를 SSR 시 주입 → 첫 페인트부터 정확(FOUC 없음)
  const theme = await getActiveTheme()
  return (
    <html lang="ko" data-theme={theme}>
      <body>{children}</body>
    </html>
  )
}
