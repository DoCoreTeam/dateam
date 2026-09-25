/**
 * 조치 — **AI 가 할 수 있는 것은 명시 목록뿐이다** (명세 §15.3)
 *
 * ## 왜 기본이 사람인가
 *
 * 허용 목록이 아니라 금지 목록으로 두면, 새 조치가 생길 때 **아무도 검토하지 않은 채로**
 * AI 에게 열린다. 금지 목록에 적는 것을 잊는 쪽이 허용 목록에 적는 것을 잊는 쪽보다
 * 훨씬 흔하고, 잊었을 때의 결과가 다르다 — 앞은 조용히 열리고 뒤는 조용히 막힌다.
 *
 * ## 왜 되돌릴 수 있는 것만인가
 *
 * AI 의 판단이 틀렸을 때 되돌릴 수 없으면 그 실수는 영구적이다. 되돌릴 수 있는 일만
 * 맡기면 틀려도 고칠 수 있고, 그래야 맡길 범위를 넓혀 갈 수 있다.
 */

import type { CheckId, CheckStatus } from './checks.ts'

export const ACTION_IDS = [
  /** 안 나간 알림을 다시 보낸다. 되돌릴 수 있다 — 아웃박스가 두 번 안 보낸다 */
  'retry_notifications',
  /** 빠진 봉을 다시 받는다. 되돌릴 수 있다 — 같은 봉은 유일 키가 하나로 만든다 */
  'backfill_bars',
  /** 자료를 다시 분석한다 */
  'reanalyze_source',
  /** 점검 결과를 사람에게 넘긴다. 이것 자체는 조치가 아니라 인계다 */
  'hand_off',
] as const
export type ActionId = (typeof ACTION_IDS)[number]

export const ACTION_LABEL: Record<ActionId, string> = {
  retry_notifications: '안 나간 알림 다시 보내기',
  backfill_bars: '빠진 봉 다시 받기',
  reanalyze_source: '자료 다시 분석하기',
  hand_off: '사람에게 넘기기',
}

/**
 * AI 가 스스로 할 수 있는 조치. **이 셋뿐이다.**
 *
 * 셋의 공통점: 되돌릴 수 있고, 돈을 안 움직이고, 설정을 안 바꾼다.
 */
export const AI_ALLOWED_ACTIONS: readonly ActionId[] = [
  'retry_notifications', 'backfill_bars', 'reanalyze_source',
]

/**
 * §15.3 「AI 가 절대 바꿀 수 없는 것」.
 *
 * 조치 이름에 이 말이 들어가면 목록에 없어도 막는다 — 새 조치를 더하면서
 * 허용 목록에 넣는 실수를 한 겹 더 막는다.
 */
export const FORBIDDEN_WORDS: readonly string[] = [
  'owner', 'credential', 'key', 'secret',
  'limit_up', 'raise_limit', 'gate', 'bypass', 'disable',
  'order', 'execute', 'trade',
  'protection', 'audit', 'intervention', 'lockbox', 'declare_pass',
]

export interface Remedy {
  checkId: CheckId
  actionId: ActionId
  /** 왜 이 조치인가 */
  reason: string
  userMessage: string
}

export type RemedyDecision =
  | { by: 'ai'; remedy: Remedy }
  /** 사람이 해야 한다. **기본이 이쪽이다** */
  | { by: 'human'; remedy: Remedy; why: string }

/**
 * 이 조치를 AI 가 해도 되나.
 *
 * 모르는 조치는 사람 몫이다 — 허용 목록에 없으면 검토를 안 거친 것이다.
 */
/**
 * 이름에 금지어가 들었나.
 *
 * 따로 내보내는 이유: 허용 목록 검사가 거의 모든 것을 이미 막아서, 이 겹만 껐을 때
 * 시험이 초록이 된다(실측). 두 겹을 따로 시험할 수 있어야 각각이 살아 있는지 안다.
 */
export function forbiddenWordIn(actionId: string): string | null {
  const lower = actionId.toLowerCase()
  return FORBIDDEN_WORDS.find((w) => lower.includes(w)) ?? null
}

export function whoDoes(actionId: string): { by: 'ai' } | { by: 'human'; why: string } {
  const word = forbiddenWordIn(actionId)
  if (word) return { by: 'human', why: `forbidden_word:${word}` }
  if (!(AI_ALLOWED_ACTIONS as readonly string[]).includes(actionId)) {
    return { by: 'human', why: 'not_in_allowlist' }
  }
  return { by: 'ai' }
}

/** 점검마다 무엇을 하나. 없으면 인계다 */
const REMEDY_BY_CHECK: Partial<Record<CheckId, ActionId>> = {
  notify_flowing: 'retry_notifications',
  bars_complete: 'backfill_bars',
}

/**
 * 이 점검에 무엇을 하나.
 *
 * `ok` 면 아무것도 안 한다. 그 밖에는 조치가 있으면 그것을, 없으면 사람에게 넘긴다 —
 * **아무것도 안 하고 넘어가는 길이 없다.**
 */
export function planRemedy(
  checkId: CheckId, status: CheckStatus, userMessage: string,
): RemedyDecision | null {
  if (status === 'ok') return null

  const actionId = REMEDY_BY_CHECK[checkId] ?? 'hand_off'
  const remedy: Remedy = {
    checkId,
    actionId,
    reason: `${checkId}:${status}`,
    userMessage,
  }
  const who = whoDoes(actionId)
  if (who.by === 'ai') return { by: 'ai', remedy }
  return { by: 'human', remedy, why: who.why }
}

/**
 * 「모른다」에는 고치는 조치를 안 붙인다.
 *
 * 무엇이 문제인지 모르는데 고치면, 고쳤는지도 모른다. `unknown` 은 사람이 먼저 봐야 한다.
 */
export function remedyFor(
  checkId: CheckId, status: CheckStatus, userMessage: string,
): RemedyDecision | null {
  const planned = planRemedy(checkId, status, userMessage)
  if (!planned) return null
  if (status === 'unknown' && planned.by === 'ai') {
    return {
      by: 'human',
      remedy: { ...planned.remedy, actionId: 'hand_off' },
      why: 'unknown_needs_human',
    }
  }
  return planned
}
