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

/**
 * 호출 한 번의 결말. provider-errors 의 분류를 키 관점으로 옮긴 값이다.
 *
 * `overload` 가 `transient` 에서 갈라져 나온 이유 (실측 2026-09-23):
 * 503 「high demand」를 원인 불명으로 두면 `withProviderKeys` 가 그 자리에서 멈춰
 * 등록해 둔 나머지 키를 한 번도 안 부른다. 무료 키 셋이 같은 모델에서 전부 503 이던 순간
 * 유료 키는 같은 모델에서 200 이었다 — **다른 키면 되는 실패**라 넘어가야 한다.
 * 그렇다고 한도는 아니므로 `disabled_reason` 은 안 건드리고 짧게만 쉰다.
 */
export type KeyOutcome = 'ok' | 'quota' | 'auth' | 'transient' | 'overload'

/** ai_provider_keys 한 줄. 표 칼럼과 1:1 이되 이름은 코드 어법을 쓴다 */
export interface KeyPoolEntry {
  id: string
  provider: AiProviderId
  /** 사람이 붙인 이름. 원장과 화면에 나가는 값이고 apiKey 는 나가지 않는다 */
  label: string
  apiKey: string
  /** 낮을수록 먼저. **같은 등급 안에서만** 뜻이 있다 (아래 isPaid) */
  priority: number
  /**
   * 결제가 붙은 키인가. 참이면 **무료 키를 다 쓴 뒤에만** 부른다.
   *
   * 왜 priority 로 대신하지 않나: 유료 키를 맨 뒤로 밀어 둬도, 그 뒤에 무료 키를 하나 더 넣으면
   * 새 줄이 맨 뒤에 붙어 유료 뒤로 간다(새 줄은 맨 뒤라는 것이 이 표의 규칙이다).
   * 「언제나 나중」은 순서가 아니라 등급이라 따로 든다.
   *
   * 키 문자열로는 알 길이 없다. 공급자가 응답에 담지 않고, 같은 키가 결제를 붙이는 순간
   * 유료가 된다. 그래서 사람이 표시하고 표에 남는다(마이그 269).
   */
  isPaid: boolean
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

/**
 * 등급. 유료가 뒤다.
 *
 * **이 저장소에서 유료 여부가 순서를 정하는 유일한 자리다.** 화면이든 저장소든 어디서
 * 「유료는 뒤로」를 또 적으면, 화면이 보여 주는 순서와 실제로 부르는 순서가 갈라진다.
 * 그때 관리자는 앞줄 키가 쓰인다고 믿으면서 뒷줄 키로 결제한다 (가드: lib/policy/ai-key-pool.test.ts).
 */
function tier(e: KeyPoolEntry): number {
  return e.isPaid ? 1 : 0
}

/** 등급이 먼저, 같은 등급 안에서 priority, 그래도 같으면 id. 셋째가 있어야 순서가 안 흔들린다 */
function byOrder(a: KeyPoolEntry, b: KeyPoolEntry): number {
  if (tier(a) !== tier(b)) return tier(a) - tier(b)
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 보이는 순서. 고르는 순서와 **같은 비교자**를 쓴다.
 *
 * 고를 때는 못 쓰는 줄이 빠지고 볼 때는 안 빠지는데(그 줄이 왜 못 쓰는지가 화면의 용건이다),
 * 그렇다고 정렬 규칙까지 다르면 화면의 「앞에 있는 키부터 씁니다」가 거짓말이 된다.
 */
export function orderForView(entries: readonly KeyPoolEntry[]): KeyPoolEntry[] {
  return [...entries].sort(byOrder)
}

/**
 * 시도할 순서를 정한다.
 *
 * 규칙 넷
 *  1 사람이 끈 키와 인증이 깨진 키는 아예 안 쓴다 (기다려도 안 풀린다)
 *  2 쉬는 중인 키는 빼고, **무료를 먼저 다 태우고 그다음 유료**, 같은 등급 안에서는 priority 낮은 것부터
 *  3 유료 키가 앞에 오는 경우는 하나뿐이다 — 쓸 수 있는 무료 키가 하나도 없을 때
 *  4 **쓸 것이 하나도 없으면 빈 목록을 주지 않는다** — 가장 빨리 풀리는 키 하나를 준다.
 *    빈 목록을 주면 부르는 쪽이 「키가 없다」와 「키가 다 쉰다」를 구별 못 하고
 *    그 기능은 그냥 죽는다. 한 번은 두드려 보는 편이 낫다 (한도가 이미 풀렸을 수도 있다).
 *    여기서는 등급보다 **빨리 풀리는 쪽**이 이긴다. 전부 쉬는 중이라 아낄 무료 키가
 *    애초에 없고, 그나마 될 법한 하나를 두드리는 것이 이 가지의 용건이기 때문이다.
 */
export function orderKeys(entries: readonly KeyPoolEntry[], now: number): KeyPoolEntry[] {
  const usable = entries.filter((e) => !isBlocked(e))
  const ready = usable.filter((e) => !isCooling(e, now)).sort(byOrder)
  if (ready.length > 0) return ready

  const soonest = [...usable].sort((a, b) => {
    const d = coolsAt(a) - coolsAt(b)
    return d !== 0 ? d : byOrder(a, b)
  })[0]
  return soonest ? [soonest] : []
}

/**
 * **훑을 순서.** 부를 순서(`orderKeys`)와 일부러 반대로, 유료가 앞이다.
 *
 * 둘이 왜 다른가: 부를 때는 무료를 먼저 태워 돈을 아끼는 것이 용건이고,
 * 훑을 때는 **가장 많이 보는 눈**으로 먼저 보는 것이 용건이다.
 * 유료 키가 뒤에 있으면 앞 키들이 못 보는 모델을 한 바퀴씩 헛되이 찌른 뒤에야 제대로 된 답이 온다.
 *
 * 이 함수가 `probe-models` 가 아니라 여기 있는 이유는 하나다 — **유료 여부로 순서를 정하는 일은
 * 이 파일 밖에서 하지 않는다.** 훑기 쪽에 손으로 sort 를 적으면 「유료는 뒤」라는 이 파일의 약속과
 * 조용히 갈라지고, 그때 관리자는 어느 키가 얼마나 불리는지 셀 수 없게 된다
 * (가드: lib/policy/ai-key-pool.test.ts).
 */
export function orderKeysForProbe(entries: readonly KeyPoolEntry[]): KeyPoolEntry[] {
  /*
    **유료를 앞으로 당길 뿐, 나머지는 준 순서 그대로다.** 여기서 `byOrder` 로 다시 정렬하면
    부르는 쪽이 이미 정해 둔 앞머리(META 키)가 뒤로 밀린다 — 순서를 두 곳에서 정하는 셈이고,
    그러면 「내가 넘긴 키부터 쓴다」는 `withProviderKeys` 의 약속이 훑기에서만 깨진다.
  */
  const usable = entries.filter((e) => !isBlocked(e))
  return [...usable.filter((e) => e.isPaid), ...usable.filter((e) => !e.isPaid)]
}

/**
 * 호출 결말을 받아 다음 상태를 만든다. 원본은 고치지 않는다.
 *
 * - ok        성공은 기억을 지운다. 한도가 풀린 키를 계속 벌주지 않는다
 * - quota     쉰다. 연속 실패가 쌓일수록 오래
 * - auth      **쉬는 게 아니라 멈춘다.** 사람이 키를 고치기 전에는 몇 번을 불러도 같은 답이다
 * - transient 짧게만 쉰다
 * - overload  짧게만 쉬고 **`disabled_reason` 은 안 적는다.** 그 키가 마른 게 아니다
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

  // 과부하와 원인 불명은 같은 짧은 시간만 쉰다. 벌이 아니라 「지금 말고 조금 뒤」라는 표시다
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
