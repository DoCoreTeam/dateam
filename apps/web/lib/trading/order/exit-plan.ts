/**
 * 자동 청산 — **진입을 자동으로 하면 청산도 자동이어야 한다** (설계 §5)
 *
 * ## 왜 진입만 자동이면 안 되나
 *
 * 진입을 시스템이 하고 청산을 사람이 하면, **사람이 자리를 비운 사이에 들어간 포지션**이
 * 생긴다. 사람은 자기가 안 낸 주문의 청산을 지켜야 하고, 못 지키면 그것이 가장 위험하다.
 * 무장은 둘을 함께 켠다 — 나눌 수 있게 만들지 않는다.
 *
 * ## 계기가 겹치면 가장 보수적인 쪽
 *
 * 손절과 목표가 같은 봉에서 둘 다 닿을 수 있다. 어느 쪽이 먼저였는지 1분 봉으로는 모른다.
 * 그때는 **손절**로 본다 — 모르는 것을 유리하게 읽으면 성적이 실제보다 좋게 나온다.
 */

export const EXIT_TRIGGERS = ['stop', 'target', 'time', 'session_close'] as const
export type ExitTrigger = (typeof EXIT_TRIGGERS)[number]

export const EXIT_LABEL: Record<ExitTrigger, string> = {
  stop: '손절',
  target: '목표',
  time: '시간 청산',
  session_close: '당일 청산',
}

/**
 * 보수적인 순서. 앞에 있을수록 먼저 고른다.
 *
 * 손절이 맨 앞인 이유: 같은 봉에서 손절과 목표가 둘 다 닿았을 때 어느 쪽이 먼저였는지
 * 1분 봉으로는 모른다. 모르는 것을 유리하게 읽으면 성적이 실제보다 좋게 나온다.
 */
export const TRIGGER_PRIORITY: readonly ExitTrigger[] = ['stop', 'session_close', 'time', 'target']

export interface ExitContext {
  direction: 'long' | 'short'
  stopPrice: number
  targetPrice: number
  /** 이번 봉의 고가·저가. 닿았는지는 종가가 아니라 범위로 본다 */
  barHigh: number
  barLow: number
  /** 진입 후 지난 분과 설정 시간 */
  minutesHeld: number
  timeExitMinutes: number
  /** 지금과 당일 청산 시각 */
  now: Date
  sameDayExitAt: Date
}

export interface ExitHit {
  trigger: ExitTrigger
  reason: string
  userMessage: string
}

/**
 * 닿은 계기 전부.
 *
 * 종가가 아니라 **봉의 범위**로 본다 — 종가만 보면 봉 안에서 손절을 지났다 돌아온 날을 놓친다.
 */
export function hitExits(ctx: ExitContext): ExitHit[] {
  const hits: ExitHit[] = []
  const hit = (trigger: ExitTrigger, reason: string) =>
    hits.push({ trigger, reason, userMessage: `${EXIT_LABEL[trigger]} 계기입니다` })

  const stopTouched = ctx.direction === 'long'
    ? ctx.barLow <= ctx.stopPrice
    : ctx.barHigh >= ctx.stopPrice
  if (stopTouched) hit('stop', `stop:${ctx.stopPrice}`)

  const targetTouched = ctx.direction === 'long'
    ? ctx.barHigh >= ctx.targetPrice
    : ctx.barLow <= ctx.targetPrice
  if (targetTouched) hit('target', `target:${ctx.targetPrice}`)

  if (ctx.timeExitMinutes > 0 && ctx.minutesHeld >= ctx.timeExitMinutes) {
    hit('time', `held:${ctx.minutesHeld}`)
  }
  if (ctx.now.getTime() >= ctx.sameDayExitAt.getTime()) {
    hit('session_close', 'session_close')
  }
  return hits
}

/**
 * 어느 계기로 청산하나. 겹치면 **가장 보수적인 쪽**.
 *
 * 목록에 없는 계기는 고르지 않는다 — 새 계기가 생겼는데 순서를 안 정하면
 * 「아무거나 하나」가 되고, 그 아무거나가 목표일 수 있다.
 */
export function chooseExit(hits: readonly ExitHit[]): ExitHit | null {
  for (const trigger of TRIGGER_PRIORITY) {
    const found = hits.find((h) => h.trigger === trigger)
    if (found) return found
  }
  return null
}

/** 청산해야 하나 */
export function shouldExit(ctx: ExitContext): ExitHit | null {
  return chooseExit(hitExits(ctx))
}

/**
 * 진입과 청산을 따로 켤 수 있나. **없다.**
 *
 * 함수로 두는 이유는 값을 주기 위해서가 아니라, 「진입만 켜자」가 코드에 생기려면
 * 여기를 고쳐야 하게 만들기 위해서다. 한 곳이면 고칠 때 보인다.
 */
export function entryAndExitArmTogether(): boolean {
  return true
}

/** 청산 주문도 같은 멱등 키를 지난다 — 같은 신호에 청산은 한 번이다 */
export function exitOrderKind(): 'exit' {
  return 'exit'
}
