'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import BrandLoaderMark from './BrandLoaderMark'
import { isRouteNavigationClick } from '@/lib/ui/nav-anchor'

interface NavigationLoaderProps {
  brandName: string
  logoUrl?: string | null
}

export default function NavigationLoader({ brandName, logoUrl }: NavigationLoaderProps) {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      // 이동인지 아닌지는 SSOT가 판정한다 — 이동이 아닌 클릭에 로더를 켜면 끌 신호(pathname 변화)가
      // 영영 안 와서 화면이 잠긴다. (사고: PDF 내보내기의 blob 다운로드 앵커)
      if (!isRouteNavigationClick({
        href: anchor.getAttribute('href'),
        hasDownload: anchor.hasAttribute('download'),
        target: anchor.target,
        pathname,
        opensElsewhere: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0,
        defaultPrevented: e.defaultPrevented,
      })) return
      pendingRef.current = true
      setLoading(true)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [pathname])

  // 최후 안전망 — 이동이 어떤 이유로든 일어나지 않으면(라우트 가드·에러·판정 실패) 로더가 스스로 꺼진다.
  // 화면이 잠기는 것보다 로더가 일찍 사라지는 편이 낫다.
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => { pendingRef.current = false; setLoading(false) }, 8000)
    return () => clearTimeout(t)
  }, [loading])

  useEffect(() => {
    if (pendingRef.current) {
      pendingRef.current = false
      setLoading(false)
    }
  }, [pathname])

  if (!loading) return null

  return (
    <div
      role="status"
      aria-label="페이지 이동 중"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        background: 'rgba(248, 247, 255, 0.55)',
      }}
    >
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)' }}>
        <BrandLoaderMark brandName={brandName} logoUrl={logoUrl} />

        <div
          aria-hidden
          style={{
            width: '140px',
            height: '3px',
            backgroundColor: 'var(--color-border)',
            borderRadius: '999px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '40%',
              backgroundColor: 'var(--brand)',
              borderRadius: '999px',
              animation: 'progress-indeterminate 1.2s ease-in-out infinite',
            }}
          />
        </div>
      </div>
    </div>
  )
}
