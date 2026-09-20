// lib/ai/key-pool.ts — 키 여러 개 중에서 무엇을 어떤 순서로 쓸지 정하는 규칙 한 벌
//
// 왜 여기 따로 두나
//   같은 판단이 지금 네 자리에 흩어져 있다 — gemini-call 의 quotaBlockedUntil,
//   ai-chat 의 pruneChain, rfp 의 host-caller, stt 의 provider. 넷이 조금씩 다르게
//   판단하면 같은 키가 어떤 길에서는 살아 있고 어떤 길에서는 죽은 것이 된다.
//   순수 함수로 빼 두면 한 벌만 고치면 되고, 그 한 벌을 실제로 셀 수 있다.
//
// 여기는 DB 도 시계도 모른다
//   now 를 인자로 받는다. 저장소는 lib/ai/key-store.ts 가 맡는다.
//   그래야 「전부 쿨다운일 때 무엇을 주나」 같은 판단을 표 없이 시험할 수 있다.

import type { AiProviderId } from './provider-catalog'

/** 한 키가 왜 못 쓰는 상태인가. 기다리면 풀리는 것과 사람이 고쳐야 하는 것을 같은 말로 하지 않는다 */
export type KeyDisabledReason = 'quota' | 'auth'

/** 호출 한 번의 결말. provider-errors 의 분류를 키 관점으로 옮긴 값이다 */
export type KeyOutcome = 'ok' | 'quota' | 'auth' | 'transient'

/** ai_provider_keys 한 줄. 표 칼럼과 1:1 이되 이름은 코드 어법을 쓴다 */
export interface KeyPoolEntry {
  id: string
  provider: AiProviderId
  /** 사람이 붙인 이름. 원장과 화면에 나가는 값이고 apiKey 는 나가지 않는다 */
  label: string
  apiKey: string
  /** 낮을수록 먼저 */
  priority: number
  /** 사람이 끈 것 */
  isActive: boolean
  /** 한도에 걸려 쉬는 중. ISO 문자열 또는 없음 */
  cooldownUntil: string | null
  disabledReason: KeyDisabledReason | null
  consecutiveFailures: number
}

/** 호출 뒤 표에 써 넣을 값. 빠진 칸은 건드리지 않는다 */
export interface KeyStatePatch {
  cooldownUntil: string | null
  disabledReason: KeyDisabledReason | null
  consecutiveFailures: number
  isActive: boolean
  lastError: string | null
}

/**
 * 한도 차단 기본 유지 시간. gemini-call 의 QUOTA_COOLDOWN_MS 와 같은 값이다.
 * 분당 한도면 이 사이에 풀리고, 일일 한도면 어차피 계속 막힌다.
 */
export const QUOTA_COOLDOWN_MS = 10 * 60_000

/**
 * 연속으로 막히면 쉬는 시간을 늘린다.
 *
 * 왜: 일일 한도에 걸린 키를 10 분마다 다시 두드리면 하루에 144 번 헛호출이다.
 * 실패가 쌓일수록 「이건 분당 한도가 아니다」는 뜻이므로 간격을 배로 민다.
 */
export const QUOTA_COOLDOWN_MAX_MS = 6 * 60 * 60_000

/** 원인 불명 실패는 짧게만 쉰다. 네트워크 한 번 튄 것으로 키를 하루 재우지 않는다 */
export const TRANSIENT_COOLDOWN_MS = 30_000

/** 사용자에게 보일 만큼만 남긴다. 공급자 원문에는 키 조각이 섞여 온다 */
export const MAX_LAST_ERROR_LEN = 200

function cooldownMsFor(consecutiveFailures: number): number {
  const doubled = QUOTA_COOLDOWN_MS * 2 ** Math.max(0, consecutiveFailures - 1)
  return Math.min(doubled, QUOTA_COOLDOWN_MAX_MS)
}

function coolsAt(entry: KeyPoolEntry): number {
  if (!entry.cooldownUntil) return 0
  const t = Date.parse(entry.cooldownUntil)
  return Number.isNaN(t) ? 0 : t
}

/** 지금 이 키가 쉬는 중인가 */
export function isCooling(entry: KeyPoolEntry, now: number): boolean {
  return coolsAt(entry) > now
}

/** 사람이 끈 것과 인증이 깨진 것. 기다려도 안 풀린다 */
export function isBlocked(entry: KeyPoolEntry): boolean {
  return !entry.isActive || entry.disabledReason === 'auth'
}

function byPriority(a: KeyPoolEntry, b: KeyPoolEntry): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 시도할 순서를 정한다.
 *
 * 규칙 셋
 *  1 사람이 끈 키와 인증이 깨진 키는 아예 안 쓴다 (기다려도 안 풀린다)
 *  2 쉬는 중인 키는 빼고 우선순위 낮은 것부터
 *  3 **쓸 것이 하나도 없으면 빈 목록을 주지 않는다** — 가장 빨리 풀리는 키 하나를 준다.
 *    빈 목록을 주면 부르는 쪽이 「키가 없다」와 「키가 다 쉰다」를 구별 못 하고
 *    그 기능은 그냥 죽는다. 한 번은 두드려 보는 편이 낫다 (한도가 이미 풀렸을 수도 있다).
 */
export function orderKeys(entries: readonly KeyPoolEntry[], now: number): KeyPoolEntry[] {
  const usable = entries.filter((e) => !isBlocked(e))
  const ready = usable.filter((e) => !isCooling(e, now)).sort(byPriority)
  if (ready.length > 0) return ready

  const soonest = [...usable].sort((a, b) => {
    const d = coolsAt(a) - coolsAt(b)
    return d !== 0 ? d : byPriority(a, b)
  })[0]
  return soonest ? [soonest] : []
}

/**
 * 호출 결말을 받아 다음 상태를 만든다. 원본은 고치지 않는다.
 *
 * - ok        성공은 기억을 지운다. 한도가 풀린 키를 계속 벌주지 않는다
 * - quota     쉰다. 연속 실패가 쌓일수록 오래
 * - auth      **쉬는 게 아니라 멈춘다.** 사람이 키를 고치기 전에는 몇 번을 불러도 같은 답이다
 * - transient 짧게만 쉰다
 */
export function nextKeyState(
  entry: KeyPoolEntry,
  outcome: KeyOutcome,
  now: number,
  errorMessage?: string,
): KeyStatePatch {
  const lastError = errorMessage ? errorMessage.slice(0, MAX_LAST_ERROR_LEN) : null

  if (outcome === 'ok') {
    return {
      cooldownUntil: null,
      disabledReason: null,
      consecutiveFailures: 0,
      isActive: entry.isActive,
      lastError: null,
    }
  }

  const failures = entry.consecutiveFailures + 1

  if (outcome === 'auth') {
    return {
      cooldownUntil: null,
      disabledReason: 'auth',
      consecutiveFailures: failures,
      // 사람이 고쳐야 풀린다. 자동으로 다시 켜지 않는다
      isActive: false,
      lastError,
    }
  }

  const ms = outcome === 'quota' ? cooldownMsFor(failures) : TRANSIENT_COOLDOWN_MS
  return {
    cooldownUntil: new Date(now + ms).toISOString(),
    disabledReason: outcome === 'quota' ? 'quota' : entry.disabledReason,
    consecutiveFailures: failures,
    isActive: entry.isActive,
    lastError,
  }
}

/** 패치를 얹은 새 줄. 원본은 그대로 둔다 */
export function applyKeyState(entry: KeyPoolEntry, patch: KeyStatePatch): KeyPoolEntry {
  return {
    ...entry,
    cooldownUntil: patch.cooldownUntil,
    disabledReason: patch.disabledReason,
    consecutiveFailures: patch.consecutiveFailures,
    isActive: patch.isActive,
  }
}

/**
 * 화면과 원장에 나가는 가림값. 앞뒤 네 글자만 남긴다.
 * 짧은 키는 길이조차 알려 주지 않는다 — 어떤 공급자인지 추측할 단서가 된다.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) return '****'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}
