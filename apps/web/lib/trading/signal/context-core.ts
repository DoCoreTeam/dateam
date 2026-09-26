/**
 * 신호 규칙이 볼 「오늘 성적」 — **순수하게**
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * `tick` 이 `emitSignal` 에 넘기던 값들이 손으로 쓴 고정값이었다(실측 2026-09-26):
 * `realizedPnlKrw: 0` · `consecutiveLosses: 0` · `minutesSinceLastLoss: null` ·
 * `rolloverOrExpiryDay: false` · `gateHits: []`.
 *
 * 그래서 SR-06(목표 도달)·SR-08(연속 손실 쿨다운)·SR-04(교체일)는 **한 번도 안 걸렸고**,
 * §10 이 말하는 「안전 게이트 통과 후 규칙을 본다」도 빈 배열이라 말뿐이었다.
 * 값은 전부 그 자리에 있었다 — `runWatch` 가 이미 세 놓은 것을 tick 이 버리고 있었다.
 */

import type { RealizedTrade } from '../position/pnl.ts'
import { realizedPnlKrw } from '../position/pnl.ts'

export type TimedTrade = RealizedTrade & { closedAt: string }

export interface LossStreak {
  /** 마지막에서부터 이어지는 손실 수 */
  consecutiveLosses: number
  /** 마지막 손실 이후 지난 분. 손실이 없으면 null */
  minutesSinceLastLoss: number | null
}

/**
 * 연속 손실을 **뒤에서부터** 센다.
 *
 * 앞에서 세면 「오늘 몇 번 졌나」이지 「지금 연속 몇 번째인가」가 아니다.
 * 이익이 하나 끼면 거기서 끊긴다 — 끊긴 뒤의 옛 손실은 쿨다운과 상관없다.
 * 본전(0원)은 손실이 아니다. 손실로 치면 수수료가 0 인 설정에서 무승부가 쿨다운을 건다.
 */
export function lossStreakFrom(
  closed: readonly TimedTrade[],
  now: Date,
): LossStreak {
  const ordered = [...closed].sort((a, b) => a.closedAt.localeCompare(b.closedAt))
  let count = 0
  let lastLossAt: string | null = null
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (realizedPnlKrw(ordered[i]) >= 0) break
    // **가장 최근 손실만** 들고 있는다. 매번 덮어쓰면 연패의 첫 손실 시각이 남고,
    // 그러면 쿨다운이 이미 지난 것으로 보여 연패 직후에 바로 다시 들어간다
    if (count === 0) lastLossAt = ordered[i].closedAt
    count += 1
  }
  if (count === 0) return { consecutiveLosses: 0, minutesSinceLastLoss: null }
  const at = new Date(lastLossAt as string).getTime()
  if (!Number.isFinite(at)) return { consecutiveLosses: count, minutesSinceLastLoss: null }
  const minutes = Math.floor((now.getTime() - at) / 60_000)
  return { consecutiveLosses: count, minutesSinceLastLoss: Math.max(0, minutes) }
}

export interface RolloverInput {
  /** 오늘 거래일 (KST, YYYY-MM-DD) */
  today: string
  /** 오늘 쓰는 근월물의 최종거래일. 모르면 null */
  frontLastTradingDay: string | null
  /** 어제 굳혀 둔 근월물 코드. 첫 거래일이면 null */
  previousFrontCode: string | null
  /** 오늘 굳힌 근월물 코드 */
  frontCode: string
}

export type RolloverVerdict =
  | { blocked: false }
  | { blocked: true; reason: 'expiry_today' | 'rolled_today' | 'last_trading_day_unknown' }

/**
 * 오늘이 신규 금지 날인가 (SR-04 뒷줄, §6.3).
 *
 * 최종거래일이거나 교체일이면 새로 들어가지 않는다 — 둘 다 그날 안에 정리해야 하는
 * 날이고, 그런 날 새로 여는 것은 정리를 늘리는 일이다.
 *
 * **최종거래일을 모르면 막는다.** 여기서 모름을 통과로 치면 종목 정보가 낡은 날
 * 만기 당일에 새로 들어가게 되고, 그날은 15:20 에 장이 끝난다.
 * 사유가 실행 기록에 남으므로 「왜 안 나갔나」는 답할 수 있다.
 */
export function rolloverVerdict(input: RolloverInput): RolloverVerdict {
  if (input.frontLastTradingDay === null) {
    return { blocked: true, reason: 'last_trading_day_unknown' }
  }
  if (input.frontLastTradingDay === input.today) {
    return { blocked: true, reason: 'expiry_today' }
  }
  if (input.previousFrontCode !== null && input.previousFrontCode !== input.frontCode) {
    return { blocked: true, reason: 'rolled_today' }
  }
  return { blocked: false }
}
