'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { CheckCircle2, AlertCircle } from 'lucide-react'

interface QueryToastProps {
  /** 감지할 쿼리스트링 키 (값이 '1'일 때 토스트 표시) */
  param: string
  /** 토스트 본문 */
  message: string
  /** 색 변형 — success(기본) / danger */
  variant?: 'success' | 'danger'
  /** 표시 유지 시간(ms) */
  duration?: number
}

/**
 * 쿼리스트링(`?param=1`)을 감지해 뷰포트 우하단에 잠깐 띄우는 공용 토스트.
 * 표시 후 자동으로 사라지고, URL에서 해당 키만 제거(scroll:false)해 새로고침 재노출을 막는다.
 * 페이지 스크롤 위치를 건드리지 않으므로 저장 후 화면 유지에 사용한다.
 */
export default function QueryToast({
  param,
  message,
  variant = 'success',
  duration = 2800,
}: QueryToastProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = searchParams.get(param) === '1'
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) return
    const showT = setTimeout(() => setVisible(true), 20)
    const hideT = setTimeout(() => setVisible(false), duration)
    const stripT = setTimeout(() => {
      const next = new URLSearchParams(Array.from(searchParams.entries()))
      next.delete(param)
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, duration + 320)
    return () => {
      clearTimeout(showT)
      clearTimeout(hideT)
      clearTimeout(stripT)
    }
  }, [active, param, duration, pathname, router, searchParams])

  if (!active) return null

  const palette =
    variant === 'danger'
      ? { bg: 'var(--danger-bg)', border: 'var(--danger-border)', fg: 'var(--danger)' }
      : { bg: 'var(--success-bg)', border: 'var(--success-border)', fg: 'var(--success)' }
  const Icon = variant === 'danger' ? AlertCircle : CheckCircle2

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'var(--space-6)',
        right: 'var(--space-6)',
        zIndex: 'var(--z-toast)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: palette.bg,
        border: `var(--hairline) solid ${palette.border}`,
        borderRadius: 'var(--radius)',
        color: palette.fg,
        fontSize: 'var(--fs-sm)',
        fontWeight: 600,
        boxShadow: 'var(--shadow-lg)',
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        opacity: visible ? 1 : 0,
        transition:
          'opacity var(--duration-normal) ease, transform var(--duration-normal) ease',
        pointerEvents: 'none',
        maxWidth: 'min(92vw, 360px)',
      }}
    >
      <Icon size={16} />
      <span>{message}</span>
    </div>
  )
}
