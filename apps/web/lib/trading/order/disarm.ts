/**
 * 멈추는 장치 — **여섯 중 하나라도 걸리면 즉시 해제** (설계 §6)
 *
 * ## 왜 해제가 주문을 취소하지 않나
 *
 * 이미 낸 주문은 살아 있다. 자동 취소를 넣으면 「해제했더니 포지션이 반만 남았다」가 생긴다 —
 * 진입은 체결됐는데 청산 주문만 취소되는 식이다. 미체결이면 사람이 취소한다.
 *
 * ## 왜 순수 함수인가
 *
 * 「연속 실패 셋」 「대조 어긋남」 같은 것은 **안 일어나는 일**이라, DB 를 붙여 두면
 * 조합을 못 만들고 못 만드는 조합은 안 시험한다. 안 시험한 장치는 안 도는 채로 배포된다.
 */

export const DISARM_TRIGGERS = [
  'expired', 'daily_order_cap', 'order_failure_streak',
  'reconciliation_required', 'protection_breached', 'human',
] as const
export type DisarmTrigger = (typeof DISARM_TRIGGERS)[number]

export const DISARM_LABEL: Record<DisarmTrigger, string> = {
  expired: '무장 시간이 지났습니다',
  daily_order_cap: '오늘 주문 수 상한을 채웠습니다',
  order_failure_streak: '주문이 연달아 실패했습니다',
  reconciliation_required: '계좌와 기록이 다릅니다',
  protection_breached: '손절가를 지났는데 포지션이 남았습니다',
  human: '사람이 해제했습니다',
}

export interface DisarmContext {
  /** 만료 시각과 지금 */
  expiresAt: Date
  now: Date
  /** 오늘 낸 주문 수와 상한 */
  ordersToday: number
  maxOrdersPerDay: number
  /** 연속 주문 실패 수와 상한 */
  orderFailureStreak: number
  maxOrderFailureStreak: number
  /** 대조가 어긋났나 */
  reconciliationRequired: boolean
  /** 손절가를 지났나 */
  protectionBreached: boolean
}

export interface DisarmHit {
  trigger: DisarmTrigger
  reason: string
  userMessage: string
}

/**
 * 지금 풀어야 하나.
 *
 * **걸린 것을 전부 돌려준다.** 하나만 주면 화면이 「만료됐습니다」만 보여 주고,
 * 사람은 시간을 늘리면 되는 줄 안다 — 실제로는 대조가 어긋나 있는데.
 */
export function shouldDisarm(ctx: DisarmContext): DisarmHit[] {
  const hits: DisarmHit[] = []
  const hit = (trigger: DisarmTrigger, reason: string) =>
    hits.push({ trigger, reason, userMessage: DISARM_LABEL[trigger] })

  if (ctx.expiresAt.getTime() <= ctx.now.getTime()) hit('expired', 'expired')
  if (ctx.maxOrdersPerDay > 0 && ctx.ordersToday >= ctx.maxOrdersPerDay) {
    hit('daily_order_cap', `orders:${ctx.ordersToday}>=${ctx.maxOrdersPerDay}`)
  }
  if (ctx.maxOrderFailureStreak > 0 && ctx.orderFailureStreak >= ctx.maxOrderFailureStreak) {
    hit('order_failure_streak', `failures:${ctx.orderFailureStreak}`)
  }
  if (ctx.reconciliationRequired) hit('reconciliation_required', 'reconciliation_required')
  if (ctx.protectionBreached) hit('protection_breached', 'protection_breached')
  return hits
}

/** 풀렸나. 하나라도 걸리면 참 */
export function mustDisarm(ctx: DisarmContext): boolean {
  return shouldDisarm(ctx).length > 0
}

/** 기록에 적을 한 줄 */
export function disarmReason(hits: readonly DisarmHit[]): string {
  if (hits.length === 0) return 'none'
  return hits.map((h) => h.trigger).join('+')
}

/**
 * 해제가 주문을 취소하나. **아니다.**
 *
 * 함수로 두는 이유는 값을 주기 위해서가 아니라 「해제가 주문을 건드리나」를 묻는 자리를
 * 한 곳으로 모으기 위해서다. 여기가 하나뿐이면 그 판단이 코드에 흩어질 수 없다.
 */
export function disarmCancelsOrders(): boolean {
  return false
}
