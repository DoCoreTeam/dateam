/**
 * 포지션 상태와 손절 보호 (명세 §11)
 *
 * ## 정의 안 된 전이는 던진다
 *
 * 상태 기계에서 모르는 전이를 조용히 무시하면 **상태가 그대로 남는다.** 그러면 화면은
 * 「보유 중」이라 말하는데 계좌는 비어 있고, 사람은 있지도 않은 포지션의 손절을 걱정한다.
 * 어긋난 것을 어긋났다고 말해야 대조(§10 SG-04)가 걸린다.
 *
 * ## 「손절 설정함」은 보호가 아니다 (D-15 · D-47)
 *
 * 시스템이 주문을 하지 않으므로 증권사 쪽에 손절이 실제로 걸렸는지 확인할 방법이 없다.
 * 사람이 누른 것은 **자기 입력**이지 검증이 아니다. 그래서 `user_reported` 를
 * 「보호됨」으로 취급하지 않는다 — 취급하면 감시를 늦추게 되고, 안 걸린 손절을 믿고
 * 자는 밤이 생긴다. 화면에도 「사용자 입력」이라고 적는다.
 */

// ── 포지션 상태 ──────────────────────────────────────────

export const POSITION_STATES = [
  'flat', 'entry_pending', 'holding', 'exit_pending', 'reconciliation_required',
] as const
export type PositionState = (typeof POSITION_STATES)[number]

export const POSITION_EVENTS = [
  /** 사람이 「주문함」을 눌렀다 */
  'order_reported',
  /** 계좌에서 진입 체결을 봤다 */
  'entry_filled',
  /** 사람이 청산 주문을 했다고 알렸다 */
  'exit_reported',
  /** 계좌에서 청산 체결을 봤다 */
  'exit_filled',
  /** 주문이 취소·거부됐다 */
  'order_cancelled',
  /** 계좌와 우리 기록이 다르다 */
  'mismatch_found',
  /** 사람이 화면에서 대조를 확인했다 */
  'mismatch_resolved',
] as const
export type PositionEvent = (typeof POSITION_EVENTS)[number]

/**
 * 정의된 전이 전부. **여기 없는 짝은 일어나면 안 되는 일이다.**
 *
 * `mismatch_found` 는 어느 상태에서나 온다 — 계좌가 진실이고 언제든 다를 수 있다.
 * 그래서 표에 한 줄씩 적는다(모든 상태에 공통이라고 코드로 빼지 않는다,
 * 빼면 새 상태가 생겼을 때 조용히 포함된다).
 */
const TRANSITIONS: Record<PositionState, Partial<Record<PositionEvent, PositionState>>> = {
  flat: {
    order_reported: 'entry_pending',
    // 우리가 모르는 사이에 난 체결. 신호 없는 거래(`manual_trade`)도 여기로 온다
    entry_filled: 'holding',
    mismatch_found: 'reconciliation_required',
  },
  entry_pending: {
    entry_filled: 'holding',
    order_cancelled: 'flat',
    mismatch_found: 'reconciliation_required',
  },
  holding: {
    exit_reported: 'exit_pending',
    exit_filled: 'flat',
    mismatch_found: 'reconciliation_required',
  },
  exit_pending: {
    exit_filled: 'flat',
    // 청산 주문을 물렸다. 포지션은 그대로 남는다
    order_cancelled: 'holding',
    mismatch_found: 'reconciliation_required',
  },
  reconciliation_required: {
    // **코드가 스스로 못 푼다.** 사람이 화면에서 확인해야 풀린다(§11)
    mismatch_resolved: 'flat',
    mismatch_found: 'reconciliation_required',
  },
}

export class UndefinedTransitionError extends Error {
  readonly from: PositionState
  readonly event: PositionEvent

  constructor(from: PositionState, event: PositionEvent) {
    super(`정의 안 된 전이다: ${from} 에서 ${event}`)
    this.name = 'UndefinedTransitionError'
    this.from = from
    this.event = event
  }
}

/** 갈 수 있나. 화면이 단추를 그릴지 말지를 이걸로 정한다 */
export function canTransition(from: PositionState, event: PositionEvent): boolean {
  return TRANSITIONS[from][event] !== undefined
}

/**
 * 다음 상태. **정의 안 된 전이면 던진다.**
 *
 * 부르는 쪽이 먼저 `canTransition` 으로 물어야 한다. 던지는 것을 잡아 무시하면
 * 무시한 그 자리가 다시 이 주석의 첫 문단이 된다.
 */
export function nextState(from: PositionState, event: PositionEvent): PositionState {
  const to = TRANSITIONS[from][event]
  if (to === undefined) throw new UndefinedTransitionError(from, event)
  return to
}

/** 사람 확인이 있어야 풀리는 상태인가 */
export function needsHumanUnlock(state: PositionState): boolean {
  return state === 'reconciliation_required'
}

/** 감시를 계속해야 하는 상태인가. 「없음」과 「대조 필요」만 빼고 전부 감시한다 */
export function isWatchable(state: PositionState): boolean {
  return state === 'entry_pending' || state === 'holding' || state === 'exit_pending'
}

// ── 손절 보호 ────────────────────────────────────────────

export const PROTECTION_STATES = ['none', 'unknown', 'user_reported', 'breached'] as const
export type ProtectionState = (typeof PROTECTION_STATES)[number]

/** 기본은 `unknown` 이다. `none` 이 아니다 — 모르는 것과 없는 것은 다르다 */
export const DEFAULT_PROTECTION: ProtectionState = 'unknown'

/**
 * 시스템이 「보호됐다」고 볼 수 있나. **언제나 거짓이다** (D-15 · D-47).
 *
 * 함수를 두는 이유는 값을 주기 위해서가 아니라, 「보호됐나」를 묻는 자리를
 * **한 곳으로 모으기 위해서**다. 여기가 하나뿐이면 나중에 이 판정이 바뀌어도 한 곳만 본다.
 */
export function isSystemVerifiedProtection(_state: ProtectionState): boolean {
  return false
}

/** 화면에 뭐라고 적나. 「보호됨」이라는 말을 쓰지 않는다 */
export const PROTECTION_LABEL: Record<ProtectionState, string> = {
  none: '손절 없음',
  unknown: '손절 모름',
  user_reported: '사용자 입력',
  breached: '손절가를 지났습니다',
}

export interface ProtectionContext {
  state: ProtectionState
  /** 사람이 「손절 설정함」을 누른 때 */
  reportedAt: Date | null
  /** 그 뒤로 포지션이 바뀌었나 (수량·방향·종목) */
  positionChangedSince: boolean
  /** 설정 `protection_recheck_minutes` */
  recheckMinutes: number
}

export type ProtectionAsk =
  | { ask: false }
  | { ask: true; reason: 'never_reported' | 'position_changed' | 'stale'; userMessage: string }

/**
 * 손절을 다시 물어야 하나 (§11).
 *
 * 포지션이 바뀌면 이전 손절가는 다른 포지션의 것이다. 시간이 지나면 사람이 장을 떠났을 수 있다.
 * 둘 다 「눌렀으니 됐다」로 넘기면 안 걸린 손절을 믿게 된다.
 */
export function shouldAskProtection(ctx: ProtectionContext, now: Date): ProtectionAsk {
  if (ctx.state === 'breached') return { ask: false }
  if (ctx.state !== 'user_reported' || !ctx.reportedAt) {
    return { ask: true, reason: 'never_reported', userMessage: '손절을 걸었는지 알려 주세요' }
  }
  if (ctx.positionChangedSince) {
    return { ask: true, reason: 'position_changed', userMessage: '포지션이 바뀌었습니다. 손절을 다시 확인해 주세요' }
  }
  const minutes = (now.getTime() - ctx.reportedAt.getTime()) / 60_000
  if (minutes >= ctx.recheckMinutes) {
    return { ask: true, reason: 'stale', userMessage: '손절을 확인한 지 오래됐습니다. 다시 알려 주세요' }
  }
  return { ask: false }
}

export interface BreachInput {
  positionState: PositionState
  direction: 'long' | 'short'
  stopPrice: number
  /** 지금 본 값. 장중 관측이라 체결이 아니다(D-32) */
  observedPrice: number
}

/**
 * 손절가를 지났는데 포지션이 남아 있나 (`breached`).
 *
 * 가격 관측이지 체결이 아니다 — 그래서 포지션 상태를 안 바꾼다. **알림만 바꾼다**(D-32).
 */
export function detectBreach(input: BreachInput): boolean {
  if (input.positionState !== 'holding' && input.positionState !== 'exit_pending') return false
  return input.direction === 'long'
    ? input.observedPrice <= input.stopPrice
    : input.observedPrice >= input.stopPrice
}

// ── 알림 우선순위 ────────────────────────────────────────

/**
 * 어느 것을 먼저 말하나 (§10.2 를 알림 쪽으로 옮긴 것).
 *
 * 손절가를 지났는데 포지션이 남은 것이 맨 앞이다. 그 순간에 새 신호를 먼저 보여 주면
 * 사람은 위험을 늘리는 쪽으로 움직인다.
 */
export const ALERT_PRIORITY = [
  'protection_breached', 'reconciliation_required', 'open_position_risk',
  'protection_unknown', 'daily_limit', 'session_close', 'profit_target', 'new_signal',
] as const
export type AlertKey = (typeof ALERT_PRIORITY)[number]

export function alertRank(key: AlertKey): number {
  return ALERT_PRIORITY.indexOf(key)
}

/** 급한 것 먼저. 같은 급이 없으므로 안정 정렬이 필요 없다 */
export function sortAlerts(keys: readonly AlertKey[]): AlertKey[] {
  return [...keys].sort((a, b) => alertRank(a) - alertRank(b))
}

export interface StateSnapshot {
  position: PositionState
  protection: ProtectionState
}

/** 지금 무엇을 먼저 말해야 하나 */
export function topAlert(snapshot: StateSnapshot): AlertKey | null {
  const keys: AlertKey[] = []
  if (snapshot.protection === 'breached') keys.push('protection_breached')
  if (snapshot.position === 'reconciliation_required') keys.push('reconciliation_required')
  if (isWatchable(snapshot.position)) keys.push('open_position_risk')
  if (snapshot.position === 'holding' && snapshot.protection === 'unknown') keys.push('protection_unknown')
  return sortAlerts(keys)[0] ?? null
}
