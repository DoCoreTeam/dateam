import type { Metadata } from 'next'
import './globals.css'
import { getBranding } from '@/lib/branding'

// 브라우저 탭 타이틀 = 시스템 설정(brand_name). 하드코딩 제거.
export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await getBranding()
  return {
    title: brandName,
    description: '팀 루틴·KPI·주간보고 통합 관리',
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
