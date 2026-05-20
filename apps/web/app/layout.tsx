import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'newAX — 본부 운영 플랫폼',
  description: '팀 루틴·KPI·주간보고 통합 관리',
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
