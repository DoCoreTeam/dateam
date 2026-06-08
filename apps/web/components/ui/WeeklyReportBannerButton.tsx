'use client'

import Link from 'next/link'

interface WeeklyReportBannerButtonProps {
  showGlow: boolean
}

export default function WeeklyReportBannerButton({ showGlow }: WeeklyReportBannerButtonProps) {
  return (
    <Link
      href="/weekly-report"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: '#ffffff',
        backgroundColor: showGlow ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)',
        border: `var(--hairline) solid ${showGlow ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)'}`,
        borderRadius: '999px',
        padding: '0.25rem 0.875rem',
        textDecoration: 'none',
        letterSpacing: '0.02em',
        animation: showGlow ? 'bannerGlow 2s ease-in-out infinite' : 'none',
        transition: 'background 200ms, border-color 200ms',
      }}
    >
      {showGlow ? '⚠️ 주간보고 미작성' : '주간보고 작성 →'}
    </Link>
  )
}
