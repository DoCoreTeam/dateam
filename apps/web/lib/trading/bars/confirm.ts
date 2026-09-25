/**
 * 확정 봉 판정 — **이 봉을 지금 확정으로 볼 것인가** (명세 §6.2)
 *
 * ## 왜 「마감 시각이 지났다」로 안 되나
 *
 * 10:14 봉은 10:15:00 에 끝나지만, KIS 가 그 값을 확정해 주는 시점은 그보다 늦다.
 * 시각만 보고 확정하면 아직 채워지는 중인 값을 읽고, 그 값으로 판단한 뒤
 * **몇 초 뒤에 다른 값이 온다.** 백테스트는 나중 값을 보므로 실시간과 결과가 갈린다.
 *
 * 그래서 두 근거 중 하나를 요구한다.
 *   · **다음 분 봉이 이미 시작됐다** — 그러면 이 봉은 확실히 끝났다
 *   · 봉이 끝나고 여유(기본 10초)가 지났다 — 거래가 없어 다음 봉이 안 생기는 경우
 *
 * ## 왜 늦게 온 데이터로 다시 판단하지 않나
 *
 * 결측(기본 25초)으로 넘긴 봉이 30초 뒤에 도착하는 일이 있다. 그때 판단을 다시 하면
 * 그 판단은 **사람이 이미 못 쓰는 시점**에 나온다(사람 지연이 1~3분인데 이미 1분이 지났다).
 * 게다가 백테스트에는 그 지연이 없어 실시간보다 좋은 성적이 나온다 —
 * 그 차이가 그대로 기대값의 거짓말이 된다.
 */

export interface MinuteBarInput {
  startAt: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type BarDecision =
  /** 확정. 이 봉으로 판단한다 */
  | { kind: 'confirm'; bar: MinuteBarInput; basis: 'next_bar_started' | 'grace_elapsed' }
  /** 결측. 그 분의 판단은 건너뛰고 사실을 남긴다 */
  | { kind: 'missing'; reason: 'not_arrived' }
  /** 아직 판단할 때가 아니다. 같은 실행 안에서 몇 초 뒤 다시 본다 */
  | { kind: 'retry'; reason: 'too_early' }

export interface ConfirmInput {
  /** 확정하려는 1분 봉의 **시작** 시각 */
  target: Date
  now: Date
  /** KIS 가 준 봉들. 순서를 믿지 않는다 */
  bars: readonly MinuteBarInput[]
  /** 설정 `bar_grace_seconds` */
  graceSec: number
  /** 설정 `bar_missing_after_seconds` */
  missingAfterSec: number
}

const MINUTE_MS = 60_000

export function decideBarConfirmation(input: ConfirmInput): BarDecision {
  const targetMs = input.target.getTime()
  const closeMs = targetMs + MINUTE_MS
  const elapsed = input.now.getTime() - closeMs

  const bar = input.bars.find((b) => b.startAt.getTime() === targetMs) ?? null
  const hasNewer = input.bars.some((b) => b.startAt.getTime() > targetMs)

  if (bar) {
    /**
     * 다음 분 봉이 있으면 여유를 기다릴 이유가 없다 — 이미 끝난 것이 증명됐다.
     * 이 길이 있어야 거래가 활발한 시간대에 판단이 10초씩 늦지 않는다.
     */
    if (hasNewer) return { kind: 'confirm', bar, basis: 'next_bar_started' }
    if (elapsed >= input.graceSec * 1000) return { kind: 'confirm', bar, basis: 'grace_elapsed' }
    return { kind: 'retry', reason: 'too_early' }
  }

  if (elapsed >= input.missingAfterSec * 1000) return { kind: 'missing', reason: 'not_arrived' }
  return { kind: 'retry', reason: 'too_early' }
}

/** 지금 확정을 시도할 1분 봉의 시작 시각 — 직전 분 */
export function targetMinuteFor(now: Date): Date {
  const floored = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS
  return new Date(floored - MINUTE_MS)
}

// ── 묶음 봉 ──────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '15m'

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 15 }

/**
 * 1분 봉을 묶어 5·15분 봉을 만든다.
 *
 * **구성 1분 봉이 하나라도 없으면 안 만든다**(§6.2). 빠진 분을 빼고 묶으면
 * 그 봉은 다른 시장을 요약한 값이 되는데, 겉으로는 멀쩡한 봉과 구분되지 않는다.
 * 백테스트가 그 봉을 진짜로 믿으면 없는 성과가 생긴다.
 *
 * 구간의 시작은 자정 기준으로 나눈다 — 09:00·09:05… 가 되어 거래소 눈금과 맞는다.
 */
export function aggregateBars(
  minutes: readonly MinuteBarInput[],
  tf: Timeframe,
): { bars: MinuteBarInput[]; incomplete: number } {
  const size = TIMEFRAME_MINUTES[tf]
  if (size === 1) return { bars: [...minutes].sort(byStart), incomplete: 0 }

  const buckets = new Map<number, MinuteBarInput[]>()
  for (const bar of minutes) {
    const bucketMs = Math.floor(bar.startAt.getTime() / (size * MINUTE_MS)) * (size * MINUTE_MS)
    const list = buckets.get(bucketMs)
    if (list) list.push(bar)
    else buckets.set(bucketMs, [bar])
  }

  const bars: MinuteBarInput[] = []
  let incomplete = 0
  for (const [bucketMs, list] of buckets) {
    if (list.length !== size) { incomplete += 1; continue }
    const sorted = [...list].sort(byStart)
    bars.push({
      startAt: new Date(bucketMs),
      open: sorted[0].open,
      high: Math.max(...sorted.map((b) => b.high)),
      low: Math.min(...sorted.map((b) => b.low)),
      close: sorted[sorted.length - 1].close,
      volume: sorted.reduce((sum, b) => sum + b.volume, 0),
    })
  }
  return { bars: bars.sort(byStart), incomplete }
}

function byStart(a: MinuteBarInput, b: MinuteBarInput): number {
  return a.startAt.getTime() - b.startAt.getTime()
}
