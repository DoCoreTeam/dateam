/**
 * 손익과 네 구간 지연 (명세 §14.2)
 *
 * ## 왜 지연을 넷으로 가르나
 *
 * 「신호에서 체결까지 4분」만 알면 고칠 곳을 못 찾는다. 서버가 늦은 것과
 * 사람이 화면을 늦게 본 것과 보고도 망설인 것과 주문이 안 채워진 것은
 * **고치는 방법이 전부 다르다.** 서버가 늦으면 코드를 고치고, 사람이 늦게 보면
 * 알림 방식을 고치고, 망설이면 신호 문구를 고치고, 체결이 늦으면 진입 한계가를 넓힌다.
 *
 * ## 못 잰 것을 0 으로 두지 않는다
 *
 * 시각이 하나라도 비면 그 구간은 **못 잰 것**이다. 0 으로 채우면 중앙값이 내려가고
 * 「우리는 빠르다」가 된다 — 실제로는 열람 시각을 못 받은 판이 절반이었을 뿐인데.
 */

import type { Direction, InstrumentSpec } from '../risk/arithmetic.ts'

// ── 네 구간 ──────────────────────────────────────────────

export const LATENCY_SEGMENTS = ['server', 'to_open', 'to_order', 'to_fill'] as const
export type LatencySegment = (typeof LATENCY_SEGMENTS)[number]

export const SEGMENT_LABEL: Record<LatencySegment, string> = {
  server: '서버 (봉 마감에서 발송까지)',
  to_open: '사람 보기 (발송에서 열람까지)',
  to_order: '사람 판단 (열람에서 주문까지)',
  to_fill: '시장 (주문에서 체결까지)',
}

/** §14.2 의 시각들. 없는 것은 null 이다 — 비었다는 사실 자체가 자료다 */
export interface SignalTimes {
  barCloseAt: Date
  notifySentAt: Date | null
  openedAt: Date | null
  orderAt: Date | null
  fillAt: Date | null
}

const SEGMENT_BOUNDS: Record<LatencySegment, [keyof SignalTimes, keyof SignalTimes]> = {
  server: ['barCloseAt', 'notifySentAt'],
  to_open: ['notifySentAt', 'openedAt'],
  to_order: ['openedAt', 'orderAt'],
  to_fill: ['orderAt', 'fillAt'],
}

/** 한 구간의 초. 양끝 중 하나라도 비면 `null` — **0 이 아니다** */
export function segmentSeconds(times: SignalTimes, segment: LatencySegment): number | null {
  const [fromKey, toKey] = SEGMENT_BOUNDS[segment]
  const from = times[fromKey]
  const to = times[toKey]
  if (!from || !to) return null
  const seconds = (to.getTime() - from.getTime()) / 1000
  // 뒤가 앞보다 이르면 시계가 어긋난 것이다. 음수를 0 으로 눕히면 그 사실이 사라진다
  return Number.isFinite(seconds) ? seconds : null
}

export function allSegments(times: SignalTimes): Record<LatencySegment, number | null> {
  return {
    server: segmentSeconds(times, 'server'),
    to_open: segmentSeconds(times, 'to_open'),
    to_order: segmentSeconds(times, 'to_order'),
    to_fill: segmentSeconds(times, 'to_fill'),
  }
}

export interface SegmentStats {
  /** 잰 건수. 0 이면 중앙값이 null 이다 */
  measured: number
  /** 못 잰 건수. 이 숫자가 크면 위 값들을 믿으면 안 된다 */
  unmeasured: number
  medianSeconds: number | null
  p90Seconds: number | null
  p95Seconds: number | null
}

/** 가장 가까운 순위 방식. 표본이 적을 때 보간하면 없는 값이 생긴다 */
export function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.ceil(fraction * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

export function summarizeSegment(values: readonly (number | null)[]): SegmentStats {
  const measured = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  return {
    measured: measured.length,
    unmeasured: values.length - measured.length,
    medianSeconds: percentile(measured, 0.5),
    p90Seconds: percentile(measured, 0.9),
    p95Seconds: percentile(measured, 0.95),
  }
}

export function latencyReport(rows: readonly SignalTimes[]): Record<LatencySegment, SegmentStats> {
  const per = rows.map(allSegments)
  return {
    server: summarizeSegment(per.map((p) => p.server)),
    to_open: summarizeSegment(per.map((p) => p.to_open)),
    to_order: summarizeSegment(per.map((p) => p.to_order)),
    to_fill: summarizeSegment(per.map((p) => p.to_fill)),
  }
}

// ── 신호 결과 ────────────────────────────────────────────

export const SIGNAL_RESULTS = ['followed', 'late', 'skipped', 'expired'] as const
export type SignalResult = (typeof SIGNAL_RESULTS)[number]

export interface ResultInput {
  times: SignalTimes
  /** 설정 `signal_valid_minutes` (기본 10). 이 안에 체결되면 따른 것이다 */
  validMinutes: number
  /** 사람이 「건너뜀」을 눌렀나 */
  skipped: boolean
  now: Date
}

/**
 * 신호 결과를 시각으로 판정한다 (§11).
 *
 * 「건너뜀」을 먼저 본다 — 사람이 명시적으로 말한 것이 추론보다 앞선다.
 * 체결이 없고 유효 시간이 지났으면 만료다. 아직 안 지났으면 **아직 아무것도 아니다**(null).
 */
export function decideResult(input: ResultInput): SignalResult | null {
  if (input.skipped) return 'skipped'
  const deadline = new Date(input.times.barCloseAt.getTime() + input.validMinutes * 60_000)
  if (input.times.fillAt) {
    return input.times.fillAt.getTime() <= deadline.getTime() ? 'followed' : 'late'
  }
  return input.now.getTime() > deadline.getTime() ? 'expired' : null
}

// ── 손익 ────────────────────────────────────────────────

export interface RealizedTrade {
  direction: Direction
  entryPrice: number
  exitPrice: number
  quantity: number
  instrument: InstrumentSpec
  /** 왕복 수수료(원) */
  feeKrw: number
}

/** 원 단위로 떨어뜨린다. 부동소수 찌꺼기가 1원짜리 차이로 남는다 */
function toWon(value: number): number {
  return Math.round(value)
}

/**
 * **체결로만** 계산하는 실현 손익.
 *
 * 평가 손익과 섞지 않는다. 섞으면 아직 안 닫은 포지션의 평가액이 「오늘 벌었다」에 들어가고,
 * 일일 손실 한도와 수익 목표가 가격이 흔들릴 때마다 켜졌다 꺼졌다 한다(§8 D-32).
 */
export function realizedPnlKrw(trade: RealizedTrade): number {
  const points = trade.direction === 'long'
    ? trade.exitPrice - trade.entryPrice
    : trade.entryPrice - trade.exitPrice
  return toWon(points * trade.instrument.multiplier * trade.quantity - trade.feeKrw)
}

export interface DayPnl {
  /** 체결로 확정된 것만 */
  realizedKrw: number
  tradeCount: number
  /** 아직 안 닫은 포지션의 평가액. **실현과 합치지 않는다** */
  unrealizedKrw: number | null
}

export function dayPnl(
  trades: readonly RealizedTrade[], unrealizedKrw: number | null,
): DayPnl {
  return {
    realizedKrw: trades.reduce((sum, t) => sum + realizedPnlKrw(t), 0),
    tradeCount: trades.length,
    unrealizedKrw,
  }
}

/**
 * 일일 손실 한도·수익 목표가 볼 값 (§8 · SR-06).
 *
 * **실현만 준다.** 평가를 섞을 수 있는 통로를 아예 안 만든다 — 만들어 두면 언젠가 쓴다.
 */
export function pnlForLimits(pnl: DayPnl): number {
  return pnl.realizedKrw
}

/** R 배수. 1회 위험 대비 몇 배를 벌거나 잃었나 */
export function toR(pnlKrw: number, riskPerTradeKrw: number): number | null {
  if (!Number.isFinite(riskPerTradeKrw) || riskPerTradeKrw <= 0) return null
  return pnlKrw / riskPerTradeKrw
}
