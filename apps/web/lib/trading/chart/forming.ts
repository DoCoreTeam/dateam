/**
 * 화면 봉 — **묶기와 형성 중인 봉이 한 자리에서 나온다**
 *
 * ## 왜 한 모듈인가
 *
 * HTS 는 봉 단위를 고르게 해 두고, 맨 오른쪽 봉은 아직 안 닫힌 봉이다. 이 둘은 따로가
 * 아니라 **같은 사실의 앞뒤**다 — 1분봉을 5분 구간으로 묶으면 마지막 구간이 덜 차고,
 * 그 덜 찬 구간이 곧 형성 중인 봉이다. 5분봉을 고르면 5분 동안 모양이 변한다.
 *
 * ## 표에 더 안 쌓는다
 *
 * 묶음 봉을 저장하지 않는다. 이력은 1분봉이 이미 갖고 있고, 같은 사실을 두 곳에 쌓으면
 * 갈리는 날이 온다. 실어 온 1분봉을 그 자리에서 묶는다.
 *
 * ## 구간은 자정 눈금으로 나눈다
 *
 * `bars/rollup.ts` 와 같은 규칙이다 — 09:00·09:05… 가 되어 거래소 눈금과 맞는다.
 * 여기서 규칙을 새로 적으면 화면 봉과 저장 봉이 다른 시장을 요약하게 된다.
 */

import type { ChartBar } from './series.ts'

/** 화면에서 고를 수 있는 봉 단위(분). 통상 HTS 가 주는 목록이다 */
export const CHART_TIMEFRAMES = [1, 3, 5, 10, 15, 30, 60] as const
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number]

export const DEFAULT_CHART_TIMEFRAME: ChartTimeframe = 1

/** 고른 값이 목록에 있나. 밖에서 온 값(주소·기억)을 그대로 믿지 않는다 */
export function isChartTimeframe(value: unknown): value is ChartTimeframe {
  return typeof value === 'number' && (CHART_TIMEFRAMES as readonly number[]).includes(value)
}

export interface FormingBar extends ChartBar {
  /** 이 봉이 아직 안 닫혔나. 화면이 확정 봉과 다르게 그린다 */
  forming: true
}

export type DisplayBar = ChartBar | FormingBar

/** 그 봉이 형성 중인가 */
export function isForming(bar: DisplayBar): bar is FormingBar {
  return (bar as FormingBar).forming === true
}

const MINUTE_MS = 60_000

/** 그 시각이 든 구간의 시작. 자정 눈금으로 나눈다 (`bars/rollup.ts` 와 같은 규칙) */
export function bucketStart(at: number, minutes: number): number {
  const span = Math.max(1, minutes) * MINUTE_MS
  return Math.floor(at / span) * span
}

export interface BuildInput {
  /** 확정된 1분봉. 오래된 것부터 */
  bars: readonly ChartBar[]
  /** 고른 봉 단위(분) */
  minutes: number
  /**
   * 마지막으로 받은 현재가. 없으면 형성 봉을 안 그린다 —
   * 지어낸 값으로 봉을 그리면 없던 움직임이 생긴다
   */
  lastPrice: { price: number; observedAt: string } | null
  /** 지금 시각. 받는다 — 화면이 자기 시계를 쓰면 시험이 못 붙는다 */
  now: Date
  /**
   * 현재가가 이 초보다 오래되면 형성 봉을 **안 그린다.**
   * 멈춘 값을 살아 있는 것처럼 그리면 화면이 거짓말을 한다
   */
  staleAfterSeconds: number
  /** 장이 서 있나. 닫혀 있으면 형성 봉을 안 그린다 */
  live: boolean
}

/**
 * 화면에 그릴 봉을 만든다 — 확정 봉을 묶고, 맨 뒤에 형성 중인 봉을 붙인다.
 *
 * **확정 구간만 확정 봉이다.** 마지막 구간이 덜 찼으면 그것은 형성 봉이고,
 * 현재가가 있으면 그 값으로 고가·저가·종가를 늘린다.
 */
export function buildDisplayBars(input: BuildInput): DisplayBar[] {
  const minutes = Math.max(1, Math.floor(input.minutes))
  if (input.bars.length === 0) return []

  /** 구간마다 1분봉을 모은다. 시가는 첫 봉, 종가는 마지막 봉, 고·저는 전체 */
  const buckets = new Map<number, ChartBar[]>()
  for (const b of input.bars) {
    const at = Date.parse(b.at)
    if (!Number.isFinite(at)) continue
    const key = bucketStart(at, minutes)
    const list = buckets.get(key)
    if (list) list.push(b)
    else buckets.set(key, [b])
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b)
  const nowBucket = bucketStart(input.now.getTime(), minutes)

  /**
   * **「형성 중」은 「아직 바뀐다」는 뜻이다.**
   *
   * 장이 닫혔거나 현재가가 오래됐으면 그 봉은 더 안 바뀐다 — 덜 찬 구간이어도
   * 형성 중으로 그리면 안 된다. 멈춘 것을 살아 있는 것처럼 그리면 화면이 거짓말을 한다.
   */
  const priceAt = input.lastPrice ? Date.parse(input.lastPrice.observedAt) : Number.NaN
  const fresh = input.lastPrice !== null
    && Number.isFinite(priceAt)
    && (input.now.getTime() - priceAt) <= input.staleAfterSeconds * 1000
    && input.lastPrice.price > 0
  const canForm = input.live && fresh

  const out: DisplayBar[] = []
  for (const key of keys) {
    const list = buckets.get(key) ?? []
    if (list.length === 0) continue
    const merged: ChartBar = {
      at: new Date(key).toISOString(),
      open: list[0].open,
      high: Math.max(...list.map((b) => b.high)),
      low: Math.min(...list.map((b) => b.low)),
      close: list[list.length - 1].close,
      volume: list.reduce((sum, b) => sum + (b.volume ?? 0), 0),
    }
    /**
     * **지금 구간은 아직 안 닫혔다.** 1분봉이 다 안 들어왔어도 그 구간은 형성 중이다 —
     * 5분봉을 고르면 5분 동안 이 봉이 자란다.
     */
    out.push(canForm && key === nowBucket ? { ...merged, forming: true } : merged)
  }

  // 장이 닫혔거나 값이 오래됐으면 형성 봉을 손대지 않는다
  if (!canForm || !input.lastPrice) return out

  const price = input.lastPrice.price
  const last = out[out.length - 1]
  if (last && isForming(last)) {
    // 이미 이 구간 봉이 있다 — 현재가로 고·저·종가를 늘린다. 시가는 그대로다
    out[out.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    }
    return out
  }

  /**
   * 이 구간 1분봉이 아직 하나도 안 들어왔다 — 현재가 하나로 봉을 연다.
   * 시가·고가·저가·종가가 전부 그 값이고, 값이 들어올수록 벌어진다.
   */
  out.push({
    at: new Date(nowBucket).toISOString(),
    open: price, high: price, low: price, close: price, volume: null,
    forming: true,
  })
  return out
}
