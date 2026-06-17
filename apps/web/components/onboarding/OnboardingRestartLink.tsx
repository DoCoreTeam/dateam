'use client'

import { useCallback } from 'react'
import { HelpCircle } from 'lucide-react'
import { ONBOARDING_START_EVENT } from './OnboardingProvider'
import type { OnboardingSequenceKey } from '@/lib/onboarding/steps'

interface OnboardingRestartLinkProps {
  variant: 'icon' | 'text'
  /** 시작할 시퀀스(기본 main). 주간보고는 'weekly'. */
  seq?: OnboardingSequenceKey
  /** main이 아닌 시퀀스의 localStorage 게이트 키(완료/스킵 영속화 대상). */
  gateKey?: string
  /** icon 변형 라벨(기본 "둘러보기"). */
  label?: string
}

/**
 * 온보딩 재진입 버튼 (SSOT — 기존 weekly OnboardingRestartLink 흡수).
 * "ax-onboarding-start" 이벤트를 dispatch → OnboardingProvider가 수신해 투어 시작.
 */
export default function OnboardingRestartLink({ variant, seq = 'main', gateKey, label }: OnboardingRestartLinkProps) {
  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent(ONBOARDING_START_EVENT, { detail: { seq, gateKey } }))
  }, [seq, gateKey])

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={label ?? '둘러보기'}
        className="onboarding-restart-pill"
      >
        <HelpCircle size={13} aria-hidden />
        {label ?? '둘러보기'}
      </button>
    )
  }

  return (
    <div className="onboarding-restart-textwrap">
      <button type="button" onClick={handleClick} className="onboarding-restart-text">
        <HelpCircle size={13} aria-hidden />
        {label ?? '처음이신가요? 둘러보기'}
      </button>
    </div>
  )
}
