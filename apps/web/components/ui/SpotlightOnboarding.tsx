'use client'

import { useState, useEffect, useCallback } from 'react'

export const STORAGE_KEY = 'weekly_report_onboarding_done'
export const ONBOARDING_START_EVENT = 'weekly-report-onboarding-start'

interface Step {
  targetId: string
  title: string
  description: string
  stepLabel: string
}

const STEPS: Step[] = [
  {
    targetId: 'onboarding-daily-selector',
    title: '✨ AI로 주간보고 자동 생성',
    description: '이 버튼을 클릭하면 이번 주 일일업무가 목록으로 나타납니다. 포함할 업무를 선택하고 "주간보고 생성"을 누르면 AI가 자동으로 성과·계획·이슈를 작성해 드립니다.',
    stepLabel: '1/5',
  },
  {
    targetId: 'onboarding-category',
    title: '구분',
    description: '업무 카테고리를 입력하세요. 예: 영업, 마케팅, 기획 (AI 생성 시 자동으로 분류됩니다)',
    stepLabel: '2/5',
  },
  {
    targetId: 'onboarding-performance',
    title: '성과',
    description: '이번 주 완료한 업무와 결과를 작성합니다. 클릭하면 편집기가 열립니다.',
    stepLabel: '3/5',
  },
  {
    targetId: 'onboarding-plan',
    title: '계획',
    description: '다음 주 진행할 업무 계획을 작성합니다',
    stepLabel: '4/5',
  },
  {
    targetId: 'onboarding-issues',
    title: '이슈/협조사항',
    description: '진행 중 발생한 문제나 도움이 필요한 사항을 작성합니다',
    stepLabel: '5/5',
  },
]

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

interface SpotlightOnboardingProps {
  autoStart?: boolean
}

export default function SpotlightOnboarding({ autoStart = false }: SpotlightOnboardingProps) {
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  const start = useCallback(() => {
    setStep(0)
    setActive(true)
  }, [])

  const finish = useCallback(() => {
    setActive(false)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // localStorage unavailable
    }
  }, [])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      finish()
    }
  }, [step, finish])

  // Auto-start on first visit
  useEffect(() => {
    if (!autoStart) return
    try {
      const done = localStorage.getItem(STORAGE_KEY)
      if (!done) {
        const timer = setTimeout(start, 600)
        return () => clearTimeout(timer)
      }
    } catch {
      // localStorage unavailable
    }
  }, [autoStart, start])

  // Listen for manual restart events from OnboardingRestartLink
  useEffect(() => {
    const handler = () => start()
    window.addEventListener(ONBOARDING_START_EVENT, handler)
    return () => window.removeEventListener(ONBOARDING_START_EVENT, handler)
  }, [start])

  // Track spotlight target position
  useEffect(() => {
    if (!active) {
      setRect(null)
      return
    }
    const target = document.getElementById(STEPS[step].targetId)
    if (!target) return

    const update = () => {
      const r = target.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, step])

  // ESC to close
  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, finish])

  const PAD = 8

  if (!active) return null

  return (
    <>
      {/* 클릭 캡처 레이어 (투명 — 시각 효과 없음) */}
      <div
        onClick={finish}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'transparent',
        }}
      />

      {/* 스포트라이트 컷아웃: box-shadow가 바깥을 어둡게, 안쪽 타겟은 밝게 유지 */}
      {rect && (
        <div
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            zIndex: 9999,
            borderRadius: '0.75rem',
            boxShadow: '0 0 0 200vmax rgba(2, 6, 23, 0.78)',
            pointerEvents: 'none',
            outline: '2.5px solid rgba(124,58,237, 0.9)',
            outlineOffset: '0px',
          }}
        />
      )}

      {/* 툴팁 */}
      {rect && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-tooltip-title"
          style={{
            position: 'fixed',
            top: Math.min(rect.top + rect.height + PAD + 12, window.innerHeight - 220),
            left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 356)),
            zIndex: 10000,
            background: '#ffffff',
            borderRadius: '0.875rem',
            padding: '1rem 1.25rem',
            minWidth: '280px',
            maxWidth: '340px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                fontSize: '0.6875rem', fontWeight: 700, color: '#ffffff',
                background: 'var(--brand)', borderRadius: '999px', padding: '0.15rem 0.5rem',
              }}>
                {STEPS[step].stepLabel}
              </span>
              <strong id="onboarding-tooltip-title" style={{ fontSize: '0.9375rem', color: '#0f172a' }}>{STEPS[step].title}</strong>
            </div>
            <button
              type="button"
              onClick={finish}
              aria-label="온보딩 닫기"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1rem', lineHeight: 1, padding: '0.125rem' }}
            >
              ✕
            </button>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 1rem', lineHeight: 1.6 }}>
            {STEPS[step].description}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: '0.5rem', height: '0.5rem', borderRadius: '50%',
                    background: i === step ? 'var(--brand)' : '#e2e8f0',
                    transition: 'background 200ms',
                    display: 'inline-block',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={finish}
                style={{
                  padding: '0.4rem 0.875rem', background: 'none',
                  border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                  fontSize: '0.8125rem', color: '#64748b', cursor: 'pointer',
                }}
              >
                건너뛰기
              </button>
              <button
                type="button"
                onClick={next}
                style={{
                  padding: '0.4rem 1rem', background: 'var(--brand)',
                  border: 'none', borderRadius: '0.5rem',
                  fontSize: '0.8125rem', color: '#ffffff',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                {step < STEPS.length - 1 ? '다음 →' : '완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
