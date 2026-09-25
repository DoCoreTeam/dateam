/**
 * AI 개입 수준 — **자동이 기본인 항목은 하나도 없다** (명세 §15.3)
 *
 * ## 왜 항목마다 나누나
 *
 * 「AI 를 켠다·끈다」 하나로 두면, 안전한 일 하나를 맡기려고 위험한 일까지 열게 된다.
 * 그래서 항목마다 **자동·승인·끔** 셋을 둔다.
 *
 * ## 왜 자동이 기본이 아닌가
 *
 * 기본값은 아무도 안 고른 값이다. 아무도 안 고른 값으로 AI 가 돈이 걸린 일을 하면,
 * 그 일은 「하기로 정한 것」이 아니라 「막지 않은 것」이다. 둘은 책임이 다르다.
 *
 * ## 금지 항목은 어느 수준에서도 안 열린다
 *
 * 수준을 자동으로 바꿔도 §15.3 목록은 그대로다. 수준은 **허용 목록 안에서만** 움직인다 —
 * 그래서 「자동으로 바꿨더니 갑자기 할 수 있게 된 일」이 없다.
 */

import { AI_ALLOWED_ACTIONS, forbiddenWordIn, type ActionId } from './remedy-policy.ts'

export const INTERVENTION_LEVELS = ['auto', 'approve', 'off'] as const
export type InterventionLevel = (typeof INTERVENTION_LEVELS)[number]

export const LEVEL_LABEL: Record<InterventionLevel, string> = {
  auto: '자동',
  approve: '승인 뒤',
  off: '끔',
}

/** 개입 수준을 정할 수 있는 항목. **허용 조치와 같은 집합이다** */
export const INTERVENTION_ITEMS = [...AI_ALLOWED_ACTIONS] as readonly ActionId[]

/** 설정 키. `ai_intervention_` 접두사라 스펙 후보 금지 목록이 통째로 막는다 */
export function interventionKey(item: ActionId): string {
  return `ai_intervention_${item}`
}

export const INTERVENTION_KEY_PREFIX = 'ai_intervention_'

export type InterventionDecision =
  | { allowed: true; needsApproval: boolean }
  | { allowed: false; reason: string; userMessage: string }

/**
 * 이 조치를 지금 수준에서 AI 가 해도 되나.
 *
 * **금지 목록을 먼저 본다.** 수준이 무엇이든 금지는 금지다 —
 * 그래야 「자동으로 바꿨더니 갑자기 할 수 있게 된 일」이 안 생긴다.
 */
export function decideIntervention(
  item: string, level: InterventionLevel,
): InterventionDecision {
  const word = forbiddenWordIn(item)
  if (word) {
    return {
      allowed: false,
      reason: `forbidden_word:${word}`,
      userMessage: '개입 수준과 무관하게 AI 가 할 수 없는 일입니다',
    }
  }
  if (!(INTERVENTION_ITEMS as readonly string[]).includes(item)) {
    return {
      allowed: false,
      reason: 'not_an_intervention_item',
      userMessage: '개입 수준을 정할 수 있는 항목이 아닙니다',
    }
  }
  if (level === 'off') {
    return { allowed: false, reason: 'off', userMessage: '이 항목은 꺼져 있습니다' }
  }
  return { allowed: true, needsApproval: level === 'approve' }
}

/**
 * 기본 수준. **자동이 하나도 없다.**
 *
 * 알림 재발송처럼 안전해 보이는 것도 승인으로 시작한다 — 안전한지는 며칠 돌려 보고
 * 사람이 정하는 것이지, 우리가 기본값으로 정할 일이 아니다.
 */
export const DEFAULT_LEVELS: Record<ActionId, InterventionLevel> = {
  retry_notifications: 'approve',
  backfill_bars: 'approve',
  reanalyze_source: 'approve',
  // 인계는 조치가 아니다. AI 가 정할 수준이 없다
  hand_off: 'off',
}

/** 기본값에 자동이 있나. 있으면 아무도 안 고른 값으로 AI 가 일을 한다 */
export function autoByDefault(): ActionId[] {
  return (Object.keys(DEFAULT_LEVELS) as ActionId[]).filter((k) => DEFAULT_LEVELS[k] === 'auto')
}

/** 설정 값을 수준으로 읽는다. 모르는 값은 **가장 막는 쪽**으로 */
export function readLevel(value: unknown): InterventionLevel {
  if (typeof value !== 'string') return 'off'
  const found = INTERVENTION_LEVELS.find((l) => l === value)
  // 모르는 값을 자동으로 읽으면, 오타 하나가 AI 를 풀어 준다
  return found ?? 'off'
}

/** 수준을 바꾸면 언제부터인가. **다음 거래일부터** (§15.2) */
export function levelChangeTiming(): { when: 'next_trade_day'; reason: string } {
  return { when: 'next_trade_day', reason: 'intervention_level_change' }
}
