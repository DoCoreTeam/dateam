'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const DISMISS_KEY = 'friday-spotlight-dismissed'

interface FridaySpotlightOverlayProps {
  showGlow: boolean
}

export default function FridaySpotlightOverlay({ showGlow }: FridaySpotlightOverlayProps) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!showGlow) return
    try {
      const stored = sessionStorage.getItem(DISMISS_KEY)
      if (!stored) setDismissed(false)
    } catch {
      setDismissed(false)
    }
  }, [showGlow])

  if (!showGlow || dismissed) return null

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="friday-spotlight-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9990,
        background: 'rgba(15, 23, 42, 0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div style={{
        textAlign: 'center',
        padding: '2.5rem 2rem',
        background: '#ffffff',
        borderRadius: '1.5rem',
        boxShadow: '0 32px 72px rgba(15, 23, 42, 0.45)',
        maxWidth: '380px',
        width: '100%',
        animation: 'spotlightIn 240ms cubic-bezier(0.16,1,0.3,1)',
      }}>
        <div style={{ fontSize: '3rem', lineHeight: 1, marginBottom: '1rem' }} aria-hidden>📝</div>
        <h2
          id="friday-spotlight-title"
          style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.625rem', letterSpacing: '-0.03em' }}
        >
          오늘이 금요일이에요!
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9375rem', lineHeight: 1.65, margin: '0 0 1.75rem' }}>
          이번 주 주간보고를 아직 작성하지 않으셨어요.<br />
          지금 바로 기록해볼까요?
        </p>
        <Link
          href="/weekly-report"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.875rem 2rem',
            background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 60%, #7c3aed 100%)',
            color: 'white',
            borderRadius: 'var(--radius)',
            fontWeight: 700,
            fontSize: '1rem',
            textDecoration: 'none',
            letterSpacing: '-0.01em',
            animation: 'bannerGlow 2.2s ease-in-out infinite',
            boxShadow: '0 4px 20px rgba(124,58,237,0.45)',
          }}
        >
          주간보고 작성하기 →
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            display: 'block',
            margin: '1.125rem auto 0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            color: '#94a3b8',
            padding: '0.25rem 0.5rem',
            fontFamily: 'inherit',
          }}
        >
          나중에 할게요
        </button>
      </div>

      <style>{`
        @keyframes spotlightIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
    </div>
  )
}
