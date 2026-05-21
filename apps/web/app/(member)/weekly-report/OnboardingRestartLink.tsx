'use client'

import { useCallback } from 'react'
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
        title="작성 가이드 보기"
        aria-label="작성 가이드 보기"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '1.75rem', height: '1.75rem',
          background: 'none', border: '1px solid #e2e8f0', borderRadius: '50%',
          cursor: 'pointer', color: '#94a3b8', fontSize: '0.875rem',
          transition: 'border-color 120ms, color 120ms',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1'
          ;(e.currentTarget as HTMLButtonElement).style.color = '#6366f1'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0'
          ;(e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'
        }}
      >
        ?
      </button>
    )
  }

  return (
    <div style={{ marginTop: '2rem', textAlign: 'center' }}>
      <button
        type="button"
        onClick={handleClick}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.8125rem', color: '#94a3b8',
          textDecoration: 'underline', textDecorationColor: 'transparent',
          transition: 'color 120ms, text-decoration-color 120ms',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = '#6366f1'
          ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = '#6366f1'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'
          ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = 'transparent'
        }}
      >
        처음이신가요? 작성 가이드 보기
      </button>
    </div>
  )
}
