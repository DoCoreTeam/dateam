/**
 * 신호 발행 — **정해진 순서로만 나간다** (명세 M2)
 *
 * ## 왜 순서가 규칙인가
 *
 * 「안전 게이트 → 진입 조건 → 판단 → 보정 → 신호 규칙」. 이 다섯을 **다** 지나야 신호다.
 * 하나라도 건너뛰면 그 신호는 다른 것이 된다:
 *   · 게이트를 건너뛰면 깨진 데이터에서 나온 신호
 *   · 보정을 건너뛰면 확률이 아닌 숫자로 판단한 신호
 *   · 규칙을 건너뛰면 기대값이 음수여도 나가는 신호
 *
 * 그리고 이 셋은 **화면에서 똑같이 보인다.** 그래서 순서를 코드 흐름이 아니라
 * 값으로 못 박고, 시험이 그 값을 지킨다.
 *
 * ## AI 가 알림을 직접 못 보낸다 (M2)
 *
 * 판단기는 원점수만 돌려준다. 그 값이 알림이 되려면 여기를 지나야 하고,
 * 여기는 게이트와 규칙을 먼저 본다. 판단기에서 알림으로 가는 지름길은 없다.
 */

import { newSignalAllowed, type GateHit } from '../gate/safety.ts'
import { signalAllowed, type RuleBlock } from './rules.ts'

/** 지나야 하는 관문들. **순서가 값이다** */
export const EMIT_STAGES = [
  'safety_gate', 'trigger', 'judge', 'calibrate', 'signal_rules',
] as const

export type EmitStage = (typeof EMIT_STAGES)[number]

export type EmitOutcome =
  /** 신호가 나간다 */
  | { kind: 'signal' }
  /** 안 나간다. **어느 단계에서 멈췄는지**가 반드시 있다 */
  | { kind: 'blocked'; stage: EmitStage; reason: string; userMessage: string }

export interface EmitInput {
  /** 안전 게이트에 걸린 것들 */
  gateHits: readonly GateHit[]
  /** 진입 조건이 걸렸나 */
  triggerFired: boolean
  /** 판단이 완료됐나 */
  judgeCompleted: boolean
  judgeAbstainReason: string | null
  /** 보정 확률이 있나 (M3) */
  hasCalibration: boolean
  /** 신호 규칙에 막힌 것들 */
  ruleBlocks: readonly RuleBlock[]
}

/**
 * 신호를 내도 되나 — **단계 순서대로** 묻는다.
 *
 * 앞 단계에서 막히면 뒤는 아예 묻지 않는다. 게이트가 걸린 상태에서 규칙을 재면
 * 그 값은 믿을 수 없는 데이터로 계산한 것이고, 화면에 「기대값 부족」이라고 뜨면
 * 사람은 전략을 고치려 든다 — 고칠 것은 데이터인데.
 */
export function decideEmit(input: EmitInput): EmitOutcome {
  // ① 안전 게이트 — 「막혔나」 판정은 게이트 모듈이 한다. 여기서 다시 세면 규칙이 두 곳이 된다
  if (!newSignalAllowed(input.gateHits)) {
    const first = input.gateHits[0]
    return {
      kind: 'blocked', stage: 'safety_gate',
      reason: `${first.id}:${first.reason}`,
      userMessage: first.userMessage,
    }
  }

  // ② 진입 조건
  if (!input.triggerFired) {
    return {
      kind: 'blocked', stage: 'trigger',
      reason: 'no_trigger', userMessage: '진입 조건이 걸리지 않았습니다',
    }
  }

  // ③ 판단
  if (!input.judgeCompleted) {
    return {
      kind: 'blocked', stage: 'judge',
      reason: `judge_not_completed:${input.judgeAbstainReason ?? 'unknown'}`,
      userMessage: '판단기가 답을 내지 못했습니다',
    }
  }

  // ④ 보정 — 없으면 신호 없음(M3)
  if (!input.hasCalibration) {
    return {
      kind: 'blocked', stage: 'calibrate',
      reason: 'no_calibration',
      userMessage: '보정 모델이 없어 원점수를 확률로 옮길 수 없습니다',
    }
  }

  // ⑤ 신호 규칙 — 같은 이유로 판정을 규칙 모듈에서 가져온다
  if (!signalAllowed(input.ruleBlocks)) {
    const first = input.ruleBlocks[0]
    return {
      kind: 'blocked', stage: 'signal_rules',
      reason: `${first.id}:${first.reason}`,
      userMessage: first.userMessage,
    }
  }

  return { kind: 'signal' }
}

/** 어느 단계까지 갔나. 화면이 「어디서 멈췄나」를 그린다 */
export function stageIndex(stage: EmitStage): number {
  return EMIT_STAGES.indexOf(stage)
}

/**
 * 막힌 이유를 한 줄로.
 *
 * 「신호 없음」만 적으면 게이트인지 조건인지 규칙인지 모르고, 그러면 고칠 곳을 못 찾는다.
 */
export function blockedSummary(outcome: EmitOutcome): string {
  if (outcome.kind === 'signal') return 'signal'
  return `${outcome.stage}:${outcome.reason}`
}
