'use client'

import { useCallback } from 'react'
import { HelpCircle } from 'lucide-react'
import { STORAGE_KEY, ONBOARDING_START_EVENT } from '@/components/ui/SpotlightOnboarding'

interface OnboardingRestartLinkProps {
  variant: 'icon' | 'text'
}

export default function OnboardingRestartLink({ variant }: OnboardingRestartLinkProps) {
  const handleClick = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // localStorage unavailable
    }
    window.dispatchEvent(new Event(ONBOARDING_START_EVENT))
  }, [])

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label="작성 가이드 보기"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          padding: '0.3rem 0.75rem',
          background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-2)', borderRadius: '9999px',
          cursor: 'pointer', color: 'var(--brand-dark)', fontSize: '0.75rem', fontWeight: 600,
          transition: 'background 120ms, border-color 120ms',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--brand-soft-2)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--brand-soft-2)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--brand-soft)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--brand-soft-2)'
        }}
      >
        <HelpCircle size={13} />
        작성 가이드
      </button>
    )
  }

  return (
    <div style={{ marginTop: '2rem', textAlign: 'center' }}>
      <button
        type="button"
        onClick={handleClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.8125rem', color: 'var(--brand)', fontWeight: 500,
          textDecoration: 'underline', textDecorationColor: 'transparent',
          transition: 'color 120ms, text-decoration-color 120ms',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--brand-dark)'
          ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = 'var(--brand-dark)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--brand)'
          ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = 'transparent'
        }}
      >
        <HelpCircle size={13} />
        처음이신가요? 작성 가이드 보기
      </button>
    </div>
  )
}
