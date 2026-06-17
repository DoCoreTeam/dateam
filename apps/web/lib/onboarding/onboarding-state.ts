'use client'

/**
 * 온보딩 진행 상태 영속화 클라이언트 (SSOT).
 *
 * 진실의 위치 = DB(profiles.onboarding_*). 이 모듈은 /api/onboarding 으로 갱신한다.
 * localStorage는 깜빡임 방지용 보조 캐시일 뿐(진실 아님).
 *
 * 모든 호출은 best-effort: 네트워크 실패가 온보딩 UX를 막지 않는다(콘솔 경고만).
 */

const LS_KEY = 'ax_onboarding_local'

export interface OnboardingLocalCache {
  /** 완료 또는 스킵 처리됨 → 자동시작 안 함. */
  done: boolean
  /** 마지막 도달 스텝 key(재개용). */
  step: string | null
}

function readLocal(): OnboardingLocalCache {
  if (typeof window === 'undefined') return { done: false, step: null }
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return { done: false, step: null }
    const parsed = JSON.parse(raw) as Partial<OnboardingLocalCache>
    return { done: parsed.done === true, step: typeof parsed.step === 'string' ? parsed.step : null }
  } catch {
    return { done: false, step: null }
  }
}

function writeLocal(next: OnboardingLocalCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    // localStorage 사용 불가(시크릿/용량) — 무시
  }
}

export function getLocalCache(): OnboardingLocalCache {
  return readLocal()
}

/**
 * 온보딩 투어 진행 여부 런타임 플래그(window 기반 SSOT).
 * useTour가 start/destroy 시 토글하고, 실습 화면(일일등록 등)이 읽어
 * 등록 행을 is_onboarding=true 로 격리하는 데 사용한다.
 */
const ACTIVE_FLAG = '__axOnboardingActive'

export function setOnboardingActive(active: boolean): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, boolean>)[ACTIVE_FLAG] = active
}

export function isOnboardingActive(): boolean {
  if (typeof window === 'undefined') return false
  return (window as unknown as Record<string, boolean>)[ACTIVE_FLAG] === true
}

type OnboardingPostBody =
  | { step: string }
  | { completed: true }
  | { skipped: true }

async function post(body: OnboardingPostBody): Promise<void> {
  try {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })
  } catch (error: unknown) {
    // best-effort — 진행 저장 실패가 투어를 막지 않는다
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] state sync failed', error)
    }
  }
}

/** 스텝 도달 기록(재개 지점 저장). DB + 로컬 캐시. */
export async function recordStep(stepKey: string): Promise<void> {
  writeLocal({ ...readLocal(), step: stepKey })
  await post({ step: stepKey })
}

/** 완료 기록. 이후 자동시작 안 함. */
export async function recordCompleted(): Promise<void> {
  writeLocal({ done: true, step: null })
  await post({ completed: true })
}

/** 스킵 기록. 이후 자동시작 안 함(완료와는 DB에서 구분). */
export async function recordSkipped(): Promise<void> {
  writeLocal({ done: true, step: null })
  await post({ skipped: true })
}

/** 재진입("다시 하기") 시 로컬 캐시 리셋 — DB는 다음 완료/스킵 때 갱신된다. */
export function resetLocalForRestart(): void {
  writeLocal({ done: false, step: null })
}

/**
 * main 외 시퀀스(weekly/ai/gpu) 완료/스킵 처리 — DB가 아닌 localStorage 게이트로 1회성 관리.
 * (main만 DB profiles에 영속화. 화면-로컬 가이드는 main 상태를 건드리면 안 됨)
 */
export function markSequenceDone(gateKey: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(gateKey, '1')
  } catch {
    // 무시
  }
}
