'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import 'driver.js/dist/driver.css'
import { useTour } from '@/lib/onboarding/useTour'
import { getLocalCache, resetLocalForRestart } from '@/lib/onboarding/onboarding-state'
import type { OnboardingSequenceKey } from '@/lib/onboarding/steps'

/** 재진입(다시 하기) 전역 이벤트. detail.seq로 시퀀스 선택(기본 main). */
export const ONBOARDING_START_EVENT = 'ax-onboarding-start'

interface OnboardingProviderProps {
  /** 서버에서 읽은 미완료 여부 — true면 최초 자동시작 대상. */
  shouldAutoStart: boolean
  /** 재개 지점(profiles.onboarding_step). 자동시작 시 이 스텝부터. */
  resumeStepKey?: string | null
  /**
   * 자동시작할 시퀀스(기본 main).
   * weekly 등 화면-로컬 투어는 'weekly' + localGateKey로 localStorage 1회성 게이팅.
   */
  autoSequence?: OnboardingSequenceKey
  /**
   * 화면-로컬 1회 노출 게이팅 키. 주면 DB 상태 대신 이 localStorage 키로 자동시작 여부 판단.
   * (주간보고처럼 main과 독립적인 화면 가이드용 — 기존 SpotlightOnboarding 동작 보존)
   */
  localGateKey?: string
}

function localGateDone(key: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markLocalGateDone(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // 무시
  }
}

const VALID_SEQS: ReadonlySet<string> = new Set<OnboardingSequenceKey>(['main', 'ai', 'gpu', 'weekly'])

function parseOnboardParam(value: string | null): { seq: OnboardingSequenceKey; step: string | null } | null {
  if (!value) return null
  const [seqRaw, stepRaw] = value.split(':')
  if (!VALID_SEQS.has(seqRaw)) return null
  return { seq: seqRaw as OnboardingSequenceKey, step: stepRaw || null }
}

export default function OnboardingProvider({
  shouldAutoStart,
  resumeStepKey,
  autoSequence = 'main',
  localGateKey,
}: OnboardingProviderProps) {
  const { start } = useTour()
  const searchParams = useSearchParams()
  const startedRef = useRef(false)

  const onboardParam = searchParams.get('onboard')

  // URL ?onboard=seq:step 재개 — 라우트 전환 후 다음 화면에서 이어붙임
  useEffect(() => {
    const parsed = parseOnboardParam(onboardParam)
    if (!parsed) return
    void start(parsed.seq, parsed.step)
    // onboard 파라미터는 1회성 트리거 — 제거해 새로고침/뒤로가기 시 동일 step 재시작 방지(다른 쿼리는 보존)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('onboard')
      window.history.replaceState(null, '', url.pathname + url.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardParam])

  // 최초 자동시작 — URL 트리거가 없을 때만
  useEffect(() => {
    if (onboardParam) return
    if (!shouldAutoStart) return
    // 화면-로컬 게이팅(weekly 등)만 localStorage로 1회성 판단.
    // main 시퀀스는 DB(shouldAutoStart)가 유일 진실 — localStorage로 막지 않는다.
    // (관리자가 온보딩을 초기화하면 브라우저 캐시와 무관하게 즉시 재노출되어야 하므로.)
    if (localGateKey && localGateDone(localGateKey)) return

    const resume = localGateKey ? null : resumeStepKey ?? getLocalCache().step
    // startedRef는 타이머 콜백 안에서 검사/설정 — React18 StrictMode 이중마운트 시
    // cleanup이 타이머를 지운 뒤 재마운트에서도 정상 재예약되도록(early-return으로 영구 미시작 방지).
    const timer = setTimeout(() => {
      if (startedRef.current) return
      startedRef.current = true
      void start(autoSequence, resume, localGateKey)
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoStart])

  // 재진입("다시 하기") 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ seq?: OnboardingSequenceKey; gateKey?: string }>).detail
      const seq = detail?.seq && VALID_SEQS.has(detail.seq) ? detail.seq : 'main'
      // main이 아닌 시퀀스는 로컬 게이트로 관리(주간보고 등). 재시작 시 게이트 키 전달.
      const gate = seq === 'main' ? undefined : detail?.gateKey
      if (localGateKey) markLocalGateDone(localGateKey)
      else resetLocalForRestart()
      void start(seq, null, gate)
    }
    window.addEventListener(ONBOARDING_START_EVENT, handler)
    return () => window.removeEventListener(ONBOARDING_START_EVENT, handler)
  }, [start, localGateKey])

  return null
}
