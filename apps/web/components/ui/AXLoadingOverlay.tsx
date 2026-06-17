'use client'

import { forwardRef } from 'react'
import BrandLoaderMark from './BrandLoaderMark'

interface AXLoadingOverlayProps {
  isLoading: boolean
  /** 브랜드명 — 로고 이미지 alt / X마크 폴백 */
  brandName?: string
  /** 등록된 브랜드 로고 이미지 — 있으면 이미지, 없으면 X마크(DATA ALLIANCE) */
  logoUrl?: string | null
  /** 메인 상태 텍스트 (예: "AI 분석 중…") */
  label: string
  /** 부가 텍스트 (파일명, 단계 설명 등) */
  sublabel?: string
  /** 경과 시간(초) — 0이거나 undefined 시 미표시 */
  elapsed?: number
  /** 접근성 aria-label override */
  ariaLabel?: string
  /** light: 흰 블러 배경 (기본) / dark: 어두운 배경 */
  variant?: 'light' | 'dark'
  zIndex?: number
}

const AXLoadingOverlay = forwardRef<HTMLDivElement, AXLoadingOverlayProps>(
  function AXLoadingOverlay(
    {
      isLoading,
      brandName,
      logoUrl,
      label,
      sublabel,
      elapsed,
      ariaLabel,
      variant = 'light',
      zIndex = 9998,
    },
    ref
  ) {
    if (!isLoading) return null

    const isDark = variant === 'dark'

    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDark ? 'rgba(15,23,42,0.7)' : 'rgba(248,247,255,0.55)',
          backdropFilter: isDark ? 'blur(8px)' : 'blur(6px)',
          WebkitBackdropFilter: isDark ? 'blur(8px)' : 'blur(6px)',
          outline: 'none',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-5)',
            padding: 'var(--space-0) var(--space-6)',
          }}
        >
          <BrandLoaderMark brandName={brandName ?? ""} logoUrl={logoUrl} dark={isDark} />

          <span
            style={{
              fontSize: 'var(--fs-base)',
              color: isDark ? 'var(--color-border)' : 'var(--brand)',
              fontWeight: 600,
            }}
          >
            {label}
          </span>

          {sublabel && (
            <span
              style={{
                fontSize: 'var(--fs-sm)',
                color: isDark ? 'var(--text-faint)' : 'var(--brand)',
                maxWidth: '320px',
                overflowWrap: 'anywhere',
                lineHeight: 1.6,
                whiteSpace: 'pre-line',
                textAlign: 'center',
              }}
            >
              {sublabel}
            </span>
          )}

          {!isDark && (
            <div
              role="progressbar"
              aria-busy="true"
              style={{
                width: 120,
                height: 3,
                borderRadius: 3,
                background: 'var(--brand-soft-2)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: '40%',
                  borderRadius: 3,
                  background: 'var(--brand)',
                  animation: 'progress-indeterminate 1.4s ease-in-out infinite',
                }}
              />
            </div>
          )}

          {elapsed !== undefined && elapsed > 0 && (
            <span style={{ fontSize: 'var(--fs-xs)', color: isDark ? 'var(--text-faint)' : 'var(--brand-soft-2)' }}>
              {elapsed}초
            </span>
          )}
        </div>
      </div>
    )
  }
)

export default AXLoadingOverlay
