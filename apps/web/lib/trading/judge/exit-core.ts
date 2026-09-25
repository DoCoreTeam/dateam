/**
 * 청산 판단 — **섀도부터 시작한다** (명세 §7.3 D-11 · §3.1 Release 2)
 *
 * ## 왜 섀도인가
 *
 * 청산 판단은 진입보다 위험하다. 진입을 틀리면 안 들어가면 그만이지만,
 * 청산을 틀리면 **이미 들고 있는 것**을 잘못 놓거나 잘못 붙든다. 그래서 표본이 쌓이고
 * 방향별 보정이 설 때까지 기록만 한다 — 알림으로 안 나간다.
 *
 * ## 왜 진입과 같은 인터페이스인가 (§7.2)
 *
 * 「교체 가능·특권 없음」. 청산 판단기를 따로 만들면 진입과 다른 잣대로 재게 되고,
 * 둘을 비교할 수 없다. 같은 `Judge` 를 쓰고 프롬프트만 다르다.
 *
 * ## 무엇을 묻나
 *
 *   · `hold` — 계속 들고 있어도 되나
 *   · `exit_now` — 지금 나가야 하나
 *
 * 진입의 `direction` 과 달리 방향이 없다. 들고 있는 방향은 이미 정해져 있다.
 */

import type { JudgeInput } from './types.ts'

export const EXIT_PROMPT_VERSION = 'exit-prompt-v1'

/** 청산 원점수. 진입의 `RawScore` 와 **다른 꼴이다** — 묻는 것이 다르다 */
export interface ExitScore {
  /** 계속 들고 있어도 되나 */
  p_hold: number
  /** 지금 나가야 하나 */
  p_exit: number
}

export const EXIT_RESPONSE_SHAPE = '{"p_hold":0.0,"p_exit":0.0}'

/** 지금 보유 상태. **절대 날짜도 절대 가격도 없다**(§7.3) */
export interface ExitContext {
  direction: 'long' | 'short'
  /** 진입가에서 지금까지 몇 ATR 움직였나. 양수면 이익 쪽 */
  unrealizedAtr: number
  /** 손절까지 몇 ATR 남았나 */
  atrToStop: number
  /** 목표까지 몇 ATR 남았나 */
  atrToTarget: number
  /** 들고 있은 지 몇 분 */
  minutesHeld: number
  /** 당일 청산까지 몇 분 */
  minutesToSessionExit: number
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 보유 상태를 상대값으로 만든다.
 *
 * ATR 이 0 이면 만들 수 없다 — 절대값을 대신 보내면 §7.3 이 그 자리에서 깨진다.
 */
export function buildExitContext(input: {
  direction: 'long' | 'short'
  entryPrice: number
  currentPrice: number
  stopPrice: number
  targetPrice: number
  atr: number
  minutesHeld: number
  minutesToSessionExit: number
}): ExitContext | null {
  if (!(input.atr > 0)) return null
  const sign = input.direction === 'long' ? 1 : -1
  return {
    direction: input.direction,
    unrealizedAtr: round((input.currentPrice - input.entryPrice) * sign / input.atr),
    atrToStop: round(Math.abs(input.currentPrice - input.stopPrice) / input.atr),
    atrToTarget: round(Math.abs(input.targetPrice - input.currentPrice) / input.atr),
    minutesHeld: Math.max(0, Math.round(input.minutesHeld)),
    minutesToSessionExit: Math.max(0, Math.round(input.minutesToSessionExit)),
  }
}

/** 질문. 진입 프롬프트와 같은 규율을 지킨다 — 절대 날짜·뉴스·절대 가격 0건 */
export function buildExitPrompt(ctx: ExitContext, closes: readonly number[]): {
  text: string
  fingerprint: string
} {
  const facts = [
    `방향: ${ctx.direction === 'long' ? '매수 보유' : '매도 보유'}`,
    `현재 평가: ${ctx.unrealizedAtr >= 0 ? '+' : ''}${ctx.unrealizedAtr} ATR`,
    `손절까지: ${ctx.atrToStop} ATR`,
    `목표까지: ${ctx.atrToTarget} ATR`,
    `보유: ${ctx.minutesHeld}분`,
    `당일 청산까지: ${ctx.minutesToSessionExit}분`,
    `최근 종가(ATR 배수, 지금을 0 으로): ${closes.join(', ')}`,
  ]
  const text = [
    '너는 이미 들고 있는 선물 포지션을 계속 둘지 판단한다.',
    '',
    '규칙',
    '- 아래 값만 쓴다. 날짜·뉴스·지수 수준을 짐작하지 않는다',
    '- 두 확률의 합이 1 이 되게 답한다',
    '- JSON 으로만 답한다',
    '',
    ...facts.map((f) => `- ${f}`),
    '',
    `형식: ${EXIT_RESPONSE_SHAPE}`,
  ].join('\n')
  return { text, fingerprint: facts.join('|') }
}

/** 답을 읽는다. 못 읽으면 기권이다 — 산문을 억지로 숫자로 만들지 않는다 */
export function parseExitResponse(raw: string): ExitScore | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // 앞뒤에 말이 붙은 경우만 한 번 건져 본다. 그 이상은 지어내는 것이다
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { value = JSON.parse(match[0]) } catch { return null }
  }
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const hold = Number(o.p_hold)
  const exit = Number(o.p_exit)
  if (!Number.isFinite(hold) || !Number.isFinite(exit)) return null
  if (hold < 0 || exit < 0) return null
  const sum = hold + exit
  if (sum <= 0) return null
  // 합이 1 이 아니어도 버리지 않고 정규화한다. 버리면 멀쩡한 판단이 기권으로 샌다
  return { p_hold: round(hold / sum, 4), p_exit: round(exit / sum, 4) }
}

/** 나가라고 기울었나. **판정만 하고 알림은 안 만든다** — 섀도다 */
export function leansExit(score: ExitScore): boolean {
  return score.p_exit > score.p_hold
}

/** 진입 판단 입력에서 최근 종가를 ATR 배수로 */
export function exitCloses(input: JudgeInput, count: number): number[] {
  const atr = input.indicators.atr
  if (!(atr > 0)) return []
  const bars = input.bars.slice(Math.max(0, input.bars.length - count))
  const anchor = bars[bars.length - 1]?.close ?? 0
  return bars.map((b) => round((b.close - anchor) / atr))
}
