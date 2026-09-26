/**
 * 이벤트 금지 구간 — **순수하게** (명세 §6.6 · SR-05)
 *
 * 금통위·FOMC·CPI 발표 앞뒤로는 새 신호를 내지 않는다. 그 몇 분 동안
 * 가격이 움직이는 이유는 지표가 아니라 발표문이고, 우리 지표는 그것을 모른다.
 *
 * ## 왜 늦게 생겼나
 *
 * 규칙(SR-05)과 기준값(전 N분·후 M분)은 1-C 때 다 있었는데
 * `tick` 이 `inEventBlackout: false` 를 손으로 적어 넘겨 **한 번도 안 걸렸다**
 * (실측 2026-09-26). 표가 없어서였고, 표가 없는 것과 규칙이 없는 것은 다른 사실이다.
 */

export interface MarketEvent {
  name: string
  /** ISO 문자열. DB 에서 온 값이라 망가진 줄이 섞일 수 있다 */
  occursAt: string
}

export interface BlackoutInput {
  events: readonly MarketEvent[]
  at: Date
  /** 이벤트 전 이만큼부터 막는다 */
  beforeMinutes: number
  /** 이벤트 후 이만큼까지 막는다 */
  afterMinutes: number
}

/**
 * 지금이 어느 이벤트의 금지 구간 안인가.
 *
 * 경계는 **양끝 포함**이다. 30분 전 정각은 이미 그 구간이고, 15분 후 정각도 아직이다 —
 * 한쪽만 열어 두면 그 1분에 낸 신호를 나중에 설명할 수 없다.
 *
 * 시각이 망가진 줄은 **건너뛴다.** 그 줄 하나 때문에 판정을 통째로 포기하면
 * 옆에 있는 멀쩡한 이벤트도 같이 무시된다.
 */
export function blackoutEventAt(input: BlackoutInput): MarketEvent | null {
  const now = input.at.getTime()
  const before = Math.max(0, input.beforeMinutes) * 60_000
  const after = Math.max(0, input.afterMinutes) * 60_000
  for (const event of input.events) {
    const at = new Date(event.occursAt).getTime()
    if (!Number.isFinite(at)) continue
    if (now >= at - before && now <= at + after) return event
  }
  return null
}

/** 걸렸나만 묻는 자리 */
export function inEventBlackout(input: BlackoutInput): boolean {
  return blackoutEventAt(input) !== null
}

/**
 * 이 구간의 이벤트만 남긴다. 매분 표 전체를 훑지 않게 읽는 쪽이 범위를 좁힐 때 쓴다.
 * 여유를 넉넉히 두는 이유: 경계에 걸친 이벤트를 빼 버리면 그 이벤트는 없는 것이 된다.
 */
export function windowFor(at: Date, beforeMinutes: number, afterMinutes: number): { from: Date; until: Date } {
  return {
    from: new Date(at.getTime() - Math.max(0, afterMinutes) * 60_000),
    until: new Date(at.getTime() + Math.max(0, beforeMinutes) * 60_000),
  }
}
