'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Driver, DriveStep } from 'driver.js'
import {
  getSequence,
  findStepIndex,
  type OnboardingSequence,
  type OnboardingSequenceKey,
  type OnboardingStep,
} from './steps'
import { recordStep, recordCompleted, recordSkipped, markSequenceDone, setOnboardingActive } from './onboarding-state'

/**
 * driver.js 래핑 훅 (SSOT 엔진).
 *
 * - 동적 import("driver.js")로 SSR 시 document 접근 회피.
 * - 강조 클릭/입력 = 기본값(disableActiveInteraction:false) 그대로.
 * - 게이팅 스텝: showButtons:[]로 Next 숨김 → 행동 성공 시 "ax-onboarding-advance" 이벤트로 moveNext().
 * - 사고종료 방지: allowClose:false. 명시적 X(close)만 종료.
 * - reduced-motion: matchMedia 감지 → animate:false.
 * - 라우트 분기 스텝은 onNextClick에서 router.push 후 다음 화면에서 재개(URL ?onboard= 동기화).
 */

/** 게이팅 스텝 행동 성공 신호. detail.event === step.interactionEvent 일 때 moveNext. */
export const ADVANCE_EVENT = 'ax-onboarding-advance'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface UseTourReturn {
  /** 시퀀스 시작. fromStepKey 주면 그 스텝부터(재개). */
  start: (seqKey: OnboardingSequenceKey, fromStepKey?: string | null, gateKey?: string) => Promise<void>
  /** 현재 활성 투어 1스텝 전진(게이팅 행동 성공 시 외부 호출용). */
  moveNext: () => void
  /** 투어 종료(파괴) — 완료/스킵 기록 없이 단순 정지. */
  stop: () => void
  /** 현재 활성 여부. */
  isActive: () => boolean
}

export function useTour(): UseTourReturn {
  const router = useRouter()
  const pathname = usePathname()
  const driverRef = useRef<Driver | null>(null)
  const seqRef = useRef<OnboardingSequence | null>(null)
  /** 현재 활성 driver 인스턴스가 강조 중인 라우트 스텝 목록(activeIndex 매칭용). */
  const routeStepsRef = useRef<OnboardingStep[]>([])
  /** main이 아닌 시퀀스의 localStorage 게이트 키. 있으면 완료/스킵을 DB 대신 로컬에 기록. */
  const gateKeyRef = useRef<string | null>(null)

  const destroy = useCallback(() => {
    driverRef.current?.destroy()
    driverRef.current = null
    seqRef.current = null
    routeStepsRef.current = []
    setOnboardingActive(false)
  }, [])

  /** OnboardingStep[] → driver.js DriveStep[]. 현재 라우트에 해당하는 스텝만 강조 대상. */
  const toDriveSteps = useCallback(
    (seq: OnboardingSequence, currentPath: string): DriveStep[] => {
      const routeSteps = seq.steps.filter((s) => s.route === currentPath)
      const lastGlobalIndex = seq.steps.length - 1

      return routeSteps.map((step): DriveStep => {
        const globalIndex = seq.steps.indexOf(step)
        const isLastOfAll = globalIndex === lastGlobalIndex
        const showButtons = step.gated ? [] : (['next', 'close'] as const)

        const drive: DriveStep = {
          // 타겟 미존재 시 resolveElement가 undefined → driver.js가 중앙 모달로 폴백
          element: step.element
            ? ((() => resolveElement(step.element!)) as () => Element)
            : undefined,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side ?? 'bottom',
            align: step.align ?? 'start',
            showButtons: [...showButtons],
            doneBtnText: isLastOfAll ? '시작하기' : '다음',
            nextBtnText: '다음',
            onNextClick: () => handleNext(seq, step, isLastOfAll),
            onCloseClick: () => handleClose(seq),
          },
        }
        return drive
      })
    },
    // handleNext/handleClose are stable via refs below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /** Next 진행: 라우트가 바뀌는 경계면 router.push, 마지막이면 완료 기록. */
  const handleNext = useCallback(
    (seq: OnboardingSequence, step: OnboardingStep, isLastOfAll: boolean) => {
      const obj = driverRef.current
      if (!obj) return

      if (isLastOfAll) {
        if (gateKeyRef.current) markSequenceDone(gateKeyRef.current)
        else void recordCompleted()
        destroy()
        return
      }

      const globalIndex = seq.steps.indexOf(step)
      const nextStep = seq.steps[globalIndex + 1]
      // 진행 지점 저장은 main(DB)만. 로컬 게이트 시퀀스는 단일 라우트라 재개 불필요.
      if (!gateKeyRef.current) void recordStep(nextStep.key)

      if (nextStep.route !== step.route) {
        // 라우트 경계 — 다음 화면으로 이동하며 ?onboard= 로 재개 지점 전달(routeQuery 보존)
        destroy()
        router.push(buildStepUrl(seq.key, nextStep))
        return
      }
      obj.moveNext()
    },
    [router, destroy],
  )

  /** 명시적 종료(X) → 스킵 기록(main=DB, 그 외=로컬 게이트). */
  const handleClose = useCallback(
    (_seq: OnboardingSequence) => {
      if (gateKeyRef.current) markSequenceDone(gateKeyRef.current)
      else void recordSkipped()
      destroy()
    },
    [destroy],
  )

  const start = useCallback(
    async (seqKey: OnboardingSequenceKey, fromStepKey?: string | null, gateKey?: string) => {
      const seq = getSequence(seqKey)
      const fromIndex = findStepIndex(seq, fromStepKey ?? null)
      const targetStep = seq.steps[fromIndex]
      gateKeyRef.current = gateKey ?? null

      // 시작 라우트가 현재와 다르면 먼저 이동(다음 마운트에서 재개, routeQuery 보존)
      if (targetStep.route !== pathname) {
        router.push(buildStepUrl(seq.key, targetStep))
        return
      }

      const { driver } = await import('driver.js')
      // driver.css는 OnboardingProvider에서 1회 import(중복 방지)
      destroy()

      const routeSteps = seq.steps.filter((s) => s.route === pathname)
      const driveSteps = toDriveSteps(seq, pathname)
      if (driveSteps.length === 0) return

      // 현재 라우트 스텝 중 targetStep의 로컬 인덱스(없으면 0)
      const localStart = Math.max(0, routeSteps.findIndex((s) => s.key === targetStep.key))

      const obj = driver({
        steps: driveSteps,
        animate: !prefersReducedMotion(),
        allowClose: false,
        // 딤(오버레이) 클릭으로 종료/진행되지 않도록 — 명시적 버튼만으로 제어(사고종료 방지)
        overlayClickBehavior: () => {
          /* no-op */
        },
        showProgress: false,
        popoverClass: 'ax-onboard',
        overlayColor: 'rgb(2, 6, 23)',
        overlayOpacity: 0.72,
        stagePadding: 8,
        stageRadius: 8,
      })

      driverRef.current = obj
      seqRef.current = seq
      routeStepsRef.current = routeSteps
      setOnboardingActive(true)
      if (!gateKey) void recordStep(targetStep.key)
      // 비동기 렌더 타겟: 강조 직전 요소가 DOM에 나타날 때까지 대기(라우트 전환 직후 레이스 방지)
      if (targetStep.element) await waitForSelector(targetStep.element, 3000)
      obj.drive(localStart >= 0 ? localStart : 0)
    },
    [pathname, router, destroy, toDriveSteps],
  )

  const moveNext = useCallback(() => {
    driverRef.current?.moveNext()
  }, [])

  const stop = useCallback(() => {
    destroy()
  }, [destroy])

  const isActive = useCallback(() => driverRef.current?.isActive() ?? false, [])

  // 게이팅 스텝 행동 성공 수신 → 해당 스텝이면 전진
  useEffect(() => {
    const handler = (e: Event) => {
      const obj = driverRef.current
      const seq = seqRef.current
      if (!obj || !seq) return
      const detail = (e as CustomEvent<{ event?: string }>).detail
      // 현재 강조 중인 라우트 스텝 = routeSteps[activeIndex]
      const activeIndex = obj.getActiveIndex()
      if (activeIndex == null) return
      const active = routeStepsRef.current[activeIndex]
      if (!active?.gated || active.interactionEvent !== detail?.event) return

      const globalIndex = seq.steps.indexOf(active)
      const isLastOfAll = globalIndex === seq.steps.length - 1
      handleNext(seq, active, isLastOfAll)
    }
    window.addEventListener(ADVANCE_EVENT, handler)
    return () => window.removeEventListener(ADVANCE_EVENT, handler)
  }, [handleNext])

  // 언마운트 정리
  useEffect(() => destroy, [destroy])

  // URL ?onboard=seq:step 동기화는 OnboardingProvider가 읽어 start()를 호출한다.
  // (이 훅은 searchParams를 직접 소비하지 않고 외부 트리거를 받는다)

  return { start, moveNext, stop, isActive }
}

/**
 * 비동기 렌더 타겟 안전 조회. 없으면 undefined → driver.js가 element 없는
 * 중앙 모달로 그린다(document.body 전체 강조 부작용 회피 — DC-REV/QA 지적).
 */
function resolveElement(selector: string): Element | undefined {
  return document.querySelector(selector) ?? undefined
}

/** 타겟 요소가 DOM에 나타날 때까지 폴링(최대 timeoutMs). 미등장 시에도 resolve(중앙 폴백). */
function waitForSelector(selector: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve()
    const startedAt = performance.now()
    const tick = () => {
      if (document.querySelector(selector) || performance.now() - startedAt >= timeoutMs) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** 스텝 라우트 URL 구성: routeQuery(예: tab=cockpit) 보존 + onboard 재개 파라미터. */
function buildStepUrl(seqKey: string, step: OnboardingStep): string {
  const params = new URLSearchParams()
  if (step.routeQuery) {
    new URLSearchParams(step.routeQuery).forEach((v, k) => params.set(k, v))
  }
  params.set('onboard', `${seqKey}:${step.key}`)
  return `${step.route}?${params.toString()}`
}
