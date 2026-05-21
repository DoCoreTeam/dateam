'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface NavigationLoaderProps {
  orgName: string
}

export default function NavigationLoader({ orgName }: NavigationLoaderProps) {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return
      if (anchor.target === '_blank') return
      const normalised = href.split('?')[0]
      if (normalised === pathname) return
      pendingRef.current = true
      setLoading(true)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [pathname])

  useEffect(() => {
    if (pendingRef.current) {
      pendingRef.current = false
      setLoading(false)
    }
  }, [pathname])

  if (!loading) return null

  const chars = orgName.split('')

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
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
        <div
          aria-hidden
          style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '0.08em', userSelect: 'none' }}
        >
          {chars.map((ch, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                animation: 'char-wave 1.8s ease-in-out infinite',
                animationDelay: `${i * 0.12}s`,
              }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>

        <div
          aria-hidden
          style={{
            width: '140px',
            height: '3px',
            backgroundColor: '#e2e8f0',
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
              backgroundColor: '#6366f1',
              borderRadius: '999px',
              animation: 'progress-indeterminate 1.2s ease-in-out infinite',
            }}
          />
        </div>
      </div>
    </div>
  )
}
