/**
 * 신호 확인 — **버튼 셋뿐이다** (명세 §12)
 *
 * ## 왜 셋인가
 *
 * 「주문함 · 건너뜀 · 손절 설정함」. 이 셋은 전부 **사람이 한 일을 우리에게 알리는 것**이고,
 * 우리가 대신 하는 것은 하나도 없다. 「지금 주문」 같은 버튼은 여기 없다 —
 * 있으면 그 버튼은 언젠가 진짜로 주문하게 되고, 그것이 Release 4 다(C1 · M1).
 *
 * ## 왜 판정이 순수 함수인가
 *
 * 「이미 건너뛴 신호에 주문함을 누르면?」 「만료된 신호에 손절가를 적으면?」 같은 조합을
 * 실제로 만들어 봐야 한다. DB 와 세션이 붙어 있으면 그 조합을 못 만들고,
 * 못 만드는 조합은 안 시험하고, 안 시험한 자리는 눌러 보면 500 이 난다.
 */

import type { SignalResult } from '../position/pnl.ts'

/** 화면에 있는 버튼. **이 셋이 전부다** */
export const ACK_ACTIONS = ['ordered', 'skipped', 'stop_reported'] as const
export type AckAction = (typeof ACK_ACTIONS)[number]

export const ACK_LABEL: Record<AckAction, string> = {
  ordered: '주문함',
  skipped: '건너뜀',
  stop_reported: '손절 설정함',
}

export interface AckState {
  /** 이미 정해진 결과. 없으면 아직 아무것도 안 눌렀다 */
  result: SignalResult | null
  /** 이미 확인 버튼을 눌렀나 */
  ackedAt: Date | null
  /** 신호가 아직 유효한가 */
  expired: boolean
}

export type AckDecision =
  | { allowed: true }
  | { allowed: false; reason: string; userMessage: string }

/**
 * 지금 이 버튼을 눌러도 되나.
 *
 * 이미 결과가 정해진 신호는 다시 안 바꾼다 — 기록은 그때 사람이 무엇을 했나이고,
 * 나중에 고치면 지연 통계가 거짓이 된다. 손절 입력만 예외다:
 * 포지션이 살아 있는 동안 손절가는 바뀔 수 있고 그것을 못 적으면 감시가 옛 값을 본다.
 */
export function decideAck(action: AckAction, state: AckState): AckDecision {
  if (action === 'stop_reported') {
    if (state.result === 'skipped') {
      return {
        allowed: false, reason: 'already_skipped',
        userMessage: '건너뛴 신호에는 손절을 적을 수 없습니다',
      }
    }
    return { allowed: true }
  }

  if (state.result !== null) {
    return {
      allowed: false, reason: `already_${state.result}`,
      userMessage: '이미 결과가 적힌 신호입니다',
    }
  }
  if (state.expired && action === 'ordered') {
    // 만료 뒤 주문은 「늦게 따름」이다. 막지 않고 그렇게 적는다
    return { allowed: true }
  }
  return { allowed: true }
}

/** 버튼이 결과를 어떻게 바꾸나. 주문함은 체결을 봐야 정해지므로 결과를 안 정한다 */
export function resultFor(action: AckAction): SignalResult | null {
  return action === 'skipped' ? 'skipped' : null
}

export interface StopInput {
  direction: 'long' | 'short'
  referencePrice: number
  value: unknown
}

export type StopParse =
  | { ok: true; stopPrice: number }
  | { ok: false; reason: string; userMessage: string }

/**
 * 사람이 적은 손절가를 읽는다.
 *
 * 방향에 맞는 쪽인지 본다 — 롱인데 기준가보다 높은 손절가는 손절이 아니라 익절이고,
 * 그대로 적으면 이탈 판정(`breached`)이 진입 즉시 켜진다.
 */
export function parseStopPrice(input: StopInput): StopParse {
  const raw = typeof input.value === 'number' ? input.value : Number(String(input.value ?? '').trim())
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ok: false, reason: 'not_a_price', userMessage: '손절가를 숫자로 적어 주세요' }
  }
  const wrongSide = input.direction === 'long'
    ? raw >= input.referencePrice
    : raw <= input.referencePrice
  if (wrongSide) {
    return {
      ok: false, reason: 'wrong_side',
      userMessage: input.direction === 'long'
        ? '매수 손절가는 기준가보다 낮아야 합니다'
        : '매도 손절가는 기준가보다 높아야 합니다',
    }
  }
  return { ok: true, stopPrice: raw }
}
