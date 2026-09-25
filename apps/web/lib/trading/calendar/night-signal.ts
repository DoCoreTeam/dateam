/**
 * 야간장 신호 — **꺼진 채로 시작한다** (명세 §3.1 Release 3 · §6.1)
 *
 * ## 왜 꺼진 채로 시작하나
 *
 * 1-A 부터 야간 봉을 모았지만 **판단은 안 했다**(§6.1 「신호는 정규장만」).
 * 그래서 야간 표본으로 보정한 적도, 야간 성적을 잰 적도 없다.
 * 정규장에서 통과한 관문은 정규장 표본으로 통과한 것이다 —
 * 그 통과를 야간에 그대로 쓰면 재 본 적 없는 장에서 돈이 나간다.
 *
 * ## 야간 전용 우회가 없다
 *
 * 안전 게이트 열둘은 야간에도 그대로 돈다. 「야간이니까 이건 건너뛰자」를 한 번 열면
 * 그 목록은 늘어나기만 한다 — 줄이는 쪽에는 사고가 필요하고 늘리는 쪽에는 편의가 필요한데,
 * 편의는 매일 생기고 사고는 가끔 난다.
 */

import { nightTradeDate, isNightHour, type NightTradeDateRule } from './session.ts'

export interface NightSignalContext {
  /** 설정 `night_signal_enabled`. **기본 거짓** */
  enabled: boolean
  /** 야간 관문을 통과했나. 정규장 관문과 **따로** 센다 */
  nightGatePassed: boolean
  /** 야간 섀도를 며칠 돌렸나 */
  nightShadowDays: number
  /** 설정 `night_shadow_days_required` */
  requiredShadowDays: number
  /** 지금이 야간 시간인가 */
  isNight: boolean
}

export type NightSignalDecision =
  | { allowed: true }
  | { allowed: false; reason: string; userMessage: string }

/**
 * 지금 야간 신호를 내도 되나.
 *
 * 정규장과 **같은 관문**을 요구하되 **야간 표본으로** 센 것이어야 한다.
 * 정규장 관문을 그대로 쓰면 재 본 적 없는 장에서 돈이 나간다.
 */
export function mayEmitNightSignal(ctx: NightSignalContext): NightSignalDecision {
  if (!ctx.isNight) {
    // 낮이면 이 판정이 필요 없다. 부르는 쪽이 잘못 물은 것이라 막는다
    return { allowed: false, reason: 'not_night', userMessage: '지금은 야간장이 아닙니다' }
  }
  if (!ctx.enabled) {
    return {
      allowed: false, reason: 'night_signal_off',
      userMessage: '야간 신호가 꺼져 있습니다',
    }
  }
  if (!ctx.nightGatePassed) {
    return {
      allowed: false, reason: 'night_gate_not_passed',
      userMessage: '야간 표본으로 검증 관문을 통과해야 합니다. 정규장 통과는 야간에 쓰지 않습니다',
    }
  }
  if (ctx.nightShadowDays < ctx.requiredShadowDays) {
    return {
      allowed: false, reason: `not_enough_night_shadow:${ctx.nightShadowDays}`,
      userMessage: `야간 섀도가 ${ctx.nightShadowDays}일입니다. ${ctx.requiredShadowDays}일이 필요합니다`,
    }
  }
  return { allowed: true }
}

/**
 * 야간 봉이 어느 거래일에 속하나 (§6.3).
 *
 * 일일 한도·설정 적용·성과 집계가 전부 이 값을 쓴다. 규칙이 설정에서 오는 이유는
 * 거래소 기준이 바뀔 수 있고, 바뀌었을 때 코드를 고치면 그날 집계가 두 갈래가 되기 때문이다.
 */
export function nightTradeDateOf(startDate: string, rule: NightTradeDateRule): string {
  return nightTradeDate(startDate, rule)
}

/**
 * 야간에도 안전 게이트를 그대로 돌리나. **언제나 참이다.**
 *
 * 함수로 두는 이유는 값을 주기 위해서가 아니라 「야간에는 게이트를 줄이나」를 묻는 자리를
 * 한 곳으로 모으기 위해서다. 여기가 하나뿐이면 「야간이니까」가 코드에 흩어질 수 없다.
 */
export function nightRunsAllGates(): boolean {
  return true
}

/** 야간 시간인가. 판정을 여기로 모아 부르는 쪽이 제 나름의 시간 계산을 안 하게 한다 */
export function inNightWindow(at: Date): boolean {
  return isNightHour(at)
}

/**
 * 야간 켜기를 사람이 눌렀을 때.
 *
 * 켜는 것은 관문을 지나야 하고, **끄는 것은 언제나 된다** —
 * 대칭으로 만들면 야간에 문제가 생긴 날 끄지도 못한다.
 */
export function decideToggleNight(
  next: boolean, ctx: Omit<NightSignalContext, 'enabled' | 'isNight'>,
): NightSignalDecision {
  if (!next) return { allowed: true }
  return mayEmitNightSignal({ ...ctx, enabled: true, isNight: true })
}
