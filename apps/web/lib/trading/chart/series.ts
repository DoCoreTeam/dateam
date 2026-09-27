/**
 * 봉과 신호를 **한 그림이 읽을 수 있는 한 벌로** 바꾼다 — `server-only` 밖에 있다
 *
 * 사용자 지적 2026-09-28: 「차트 보이고 예측한 답은 어디서 보는 거야? 그게 메인이어야
 * 될 텐데」. 지금까지 현황은 숫자 표였다. 가격이 어디로 갔고 우리가 어디서 무엇을
 * 말했는지는 표 두 개를 눈으로 맞춰야 알 수 있었고, 그래서 아무도 안 맞춰 봤다.
 *
 * ## 왜 여기인가
 *
 * 봉을 그림 좌표로 바꾸는 일은 **한 곳에만 있어야 한다.** 화면마다 적으면 축 범위가
 * 서로 달라지고, 같은 봉이 화면에 따라 다른 높이로 그려진다. 그 순간 그림은
 * 근거가 아니라 인상이 된다.
 *
 * 그리고 **없을 때 무엇을 말할지가 이 모듈의 절반이다.** 빈 차트를 그리면 사람은
 * 「값이 0이구나」로 읽는다. 실제로는 봉이 한 줄도 안 들어온 것이고, 그 둘은
 * 할 일이 완전히 다르다 (실측 2026-09-28 trading_bars 0행).
 */

import { readRunReason, type RunReasonLine } from '../operator/run-reason.ts'

/** 그림이 읽는 봉 한 개. 시각은 ISO 그대로 두고 눈금은 화면이 만든다 */
export interface ChartBar {
  at: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** 봉 위에 찍는 신호 표식 */
export interface ChartMark {
  signalId: string
  at: string
  direction: 'long' | 'short'
  /** 그때 우리가 본 값 */
  price: number
  stopPrice: number
  targetPrice: number
  /** 보정 확률. 없으면 이 신호는 안 나갔어야 한다 */
  prob: number | null
}

export interface ChartSeries {
  bars: ChartBar[]
  marks: ChartMark[]
  /**
   * 가격 축 범위. **봉과 신호를 함께 담고 여유까지 더한 값**이라
   * 화면은 이 값을 그대로 축에 넘기면 된다 — 같은 셈을 화면에서 또 하지 않는다.
   *
   * 신호까지 담는 이유: 손절가가 축 밖이면 「손절가가 멀다」와 「손절가가 없다」가
   * 화면에서 똑같아 보인다.
   */
  domain: [number, number] | null
  /** 그릴 것이 없으면 왜 없나. 있으면 null */
  blocked: RunReasonLine | null
}

/**
 * 밖에서 온 값이라 숫자가 아닐 수 있다. 아니면 그 봉을 안 그린다.
 *
 * `Number(null)` 도 `Number('')` 도 **0 이다** — 그대로 통과시키면 값이 없던 봉이
 * 0원짜리 봉으로 그려지고 차트에 없던 폭락이 생긴다. 빈 것은 먼저 걸러낸다.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value === 'boolean') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export interface SeriesInput {
  /** 오래된 것부터. 표에서 읽은 그대로 넣어도 된다 */
  bars: readonly {
    startAt: Date | string
    open: unknown; high: unknown; low: unknown; close: unknown
    volume?: unknown
  }[]
  /** 이 구간의 신호. 봉 범위 밖의 것은 알아서 떨어진다 */
  signals: readonly {
    id: string
    direction: 'long' | 'short'
    barCloseAt: string
    referencePrice: number
    stopPrice: number
    targetPrice: number
    calibratedProb: number | null
  }[]
  /**
   * 가장 최근 실행이 남긴 사유. **화면이 따로 판정하지 않는다** —
   * 운영 화면과 같은 함수로 읽어야 두 화면이 같은 말을 한다
   */
  lastRunReason: string | null
}

export function buildSeries(input: SeriesInput): ChartSeries {
  const bars: ChartBar[] = []
  for (const row of input.bars) {
    const open = num(row.open), high = num(row.high), low = num(row.low), close = num(row.close)
    // 넷 중 하나라도 모르면 그 봉은 안 그린다. 0 으로 채우면 없던 폭락이 생긴다
    if (open === null || high === null || low === null || close === null) continue
    const at = row.startAt instanceof Date ? row.startAt.toISOString() : String(row.startAt)
    if (!Number.isFinite(Date.parse(at))) continue
    bars.push({ at, open, high, low, close, volume: num(row.volume) })
  }
  bars.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  if (bars.length === 0) {
    return { bars: [], marks: [], domain: null, blocked: blockedLine(input.lastRunReason) }
  }

  const from = Date.parse(bars[0].at)
  const to = Date.parse(bars[bars.length - 1].at)
  const marks: ChartMark[] = input.signals
    .filter((s) => {
      const at = Date.parse(s.barCloseAt)
      return Number.isFinite(at) && at >= from && at <= to
    })
    .map((s) => ({
      signalId: s.id,
      at: s.barCloseAt,
      direction: s.direction,
      price: s.referencePrice,
      stopPrice: s.stopPrice,
      targetPrice: s.targetPrice,
      prob: s.calibratedProb,
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const values = [
    ...bars.flatMap((b) => [b.high, b.low]),
    ...marks.flatMap((m) => [m.price, m.stopPrice, m.targetPrice].filter((v) => Number.isFinite(v))),
  ]
  return { bars, marks, domain: axisDomain(Math.min(...values), Math.max(...values)), blocked: null }
}

/**
 * 봉이 0건일 때 **무엇이 막혔는지**를 실행 기록에서 뽑는다.
 *
 * 화면이 따로 판정하지 않는 이유: 운영 화면과 현황이 같은 사유를 다르게 읽으면
 * 사람은 두 화면 중 어느 쪽을 믿을지 정해야 하고, 대개 덜 나쁜 쪽을 믿는다.
 */
function blockedLine(reason: string | null): RunReasonLine {
  const view = readRunReason(reason)
  const blocked = view.lines.find((l) => l.tone === 'blocked')
  if (blocked) return blocked
  if (view.headline) return view.headline
  return { text: '아직 한 번도 안 돌았습니다', tone: 'waiting' }
}

/**
 * 축에 여유를 둔다 — 봉이 위아래 선에 딱 붙으면 폭이 실제보다 커 보인다.
 * 값이 하나뿐인 날(봉 한 개)에도 범위가 0 이 되지 않게 최소 폭을 준다.
 */
export function axisDomain(low: number | null, high: number | null): [number, number] | null {
  if (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high)) return null
  const span = high - low
  const pad = span === 0 ? Math.max(Math.abs(high) * 0.001, 0.01) : span * 0.08
  return [low - pad, high + pad]
}
