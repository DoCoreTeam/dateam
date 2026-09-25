/**
 * 슬리피지 — **고정값이 아니라 우리가 모은 호가로 잰다** (명세 §13.2 · D-43)
 *
 * ## 왜 고정값이면 안 되나
 *
 * 슬리피지를 「2틱」으로 못 박으면 개장 직후와 점심때가 같은 비용이 된다. 실제로는
 * 스프레드가 시간대마다 몇 배씩 다르고, 그 차이가 그대로 기대값의 차이다.
 * 우리는 봉마다 최우선 호가를 모아 뒀으니(1-A) **그 값을 쓴다.**
 *
 * ## 왜 1·2·4·8틱을 함께 재나 (§13.5)
 *
 * 관문은 「미니 4틱·정규 2틱의 가혹 조건에서도 기대값이 0보다 큰가」를 묻는다.
 * 하나만 재면 그 답을 못 한다. 그리고 가정이 조금만 나빠져도 뒤집히는 전략은
 * 실전에서 살아남지 못한다 — **얼마나 버티는가**가 숫자 하나보다 중요하다.
 *
 * ## 스프레드가 없는 봉
 *
 * 호가를 못 받은 봉이 있다. 그때는 가정값으로 떨어지되 **그 사실을 결과에 남긴다** —
 * 가정으로 잰 비율이 높으면 그 성적은 「우리가 정한 숫자」에 가깝지 실측이 아니다.
 */

export type InstrumentKind = 'regular' | 'mini'

export interface QuoteSample {
  /** 봉 시작 시각 */
  startAt: Date
  /** 최우선 매수·매도. 못 받았으면 null */
  bestBid: number | null
  bestAsk: number | null
}

export interface SlippageParams {
  tickSize: number
  /** 호가를 못 받은 봉에 쓸 가정 틱 수 */
  fallbackTicks: number
}

/** 관문이 재는 틱 수들 (§13.5) */
export const SENSITIVITY_TICKS: readonly number[] = [1, 2, 4, 8]

/** 명세 §13.5 의 가혹 조건 */
export const HARSH_TICKS: Record<InstrumentKind, number> = { mini: 4, regular: 2 }

/** 시간대 구간. 개장 직후와 마감 전은 스프레드가 다르다 */
export type SessionPhase = 'open' | 'mid' | 'close'

export interface SpreadStat {
  phase: SessionPhase
  /** 스프레드 중앙값(틱). 평균이 아니라 중앙값 — 한 번의 이상치가 전체를 끌지 않게 */
  medianTicks: number
  sampleCount: number
  /** 호가가 없어 가정값으로 떨어진 봉 수 */
  fallbackCount: number
}

/**
 * 세션 안에서 어느 구간인가.
 *
 * @param minutesSinceOpen 접속매매 시작 후 경과 분
 * @param minutesUntilClose 접속매매 종료까지 남은 분
 */
export function phaseOf(minutesSinceOpen: number, minutesUntilClose: number): SessionPhase {
  if (minutesSinceOpen < 30) return 'open'
  if (minutesUntilClose <= 30) return 'close'
  return 'mid'
}

/** 한 봉의 스프레드를 틱으로. 호가가 없거나 뒤집혀 있으면 null */
export function spreadTicks(sample: QuoteSample, tickSize: number): number | null {
  if (sample.bestBid === null || sample.bestAsk === null) return null
  if (!(tickSize > 0)) return null
  const spread = sample.bestAsk - sample.bestBid
  // 매도가 매수보다 낮으면 잘못 받은 값이다. 음수 비용을 만들지 않는다
  if (spread < 0) return null

  /**
   * **틱은 정수다.** 스프레드는 정의상 호가 단위의 정수배인데, 부동소수로 나누면
   * 1틱이 0.9999999999991 로 나온다. 그 값으로 중앙값을 내면 비교와 표시가 모두 어긋난다.
   *
   * 먼지를 털고 **비싼 쪽으로** 올린다 — 격자에 안 맞는 값(잘못 받은 호가)을
   * 싸게 잡으면 비용을 실제보다 작게 계산하게 되고, 그 방향의 착각이 더 위험하다.
   */
  const raw = Math.round((spread / tickSize) * 1e6) / 1e6
  return Math.ceil(raw - 1e-9)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface PhasedSample extends QuoteSample {
  phase: SessionPhase
}

/**
 * 시간대별 스프레드 통계.
 *
 * 구간에 표본이 하나도 없으면 그 구간은 **결과에 안 넣는다** — 0 으로 채우면
 * 「스프레드가 0인 구간」이 생기고, 그 구간의 거래는 비용 없이 계산된다.
 */
export function spreadStats(
  samples: readonly PhasedSample[],
  params: SlippageParams,
): SpreadStat[] {
  const byPhase = new Map<SessionPhase, { ticks: number[]; fallback: number }>()
  for (const sample of samples) {
    const bucket = byPhase.get(sample.phase) ?? { ticks: [], fallback: 0 }
    const ticks = spreadTicks(sample, params.tickSize)
    if (ticks === null) bucket.fallback += 1
    else bucket.ticks.push(ticks)
    byPhase.set(sample.phase, bucket)
  }

  const stats: SpreadStat[] = []
  for (const [phase, bucket] of byPhase) {
    if (bucket.ticks.length === 0 && bucket.fallback === 0) continue
    stats.push({
      phase,
      medianTicks: bucket.ticks.length > 0 ? median(bucket.ticks) : params.fallbackTicks,
      sampleCount: bucket.ticks.length,
      fallbackCount: bucket.fallback,
    })
  }
  return stats.sort((a, b) => a.phase.localeCompare(b.phase))
}

/**
 * 한 번 들어가고 나오는 데 드는 슬리피지(포인트).
 *
 * **왕복이다.** 진입에서 한 번, 청산에서 한 번 — 편도로 계산하면 비용이 절반이 되고
 * 그만큼 기대값이 부풀어 나온다.
 */
export function roundTripSlippagePoints(ticks: number, tickSize: number): number {
  return Math.max(0, ticks) * tickSize * 2
}

export interface SlippageCase {
  ticks: number
  roundTripPoints: number
  /** 이 틱 수가 이 상품의 가혹 조건인가 (§13.5) */
  harsh: boolean
}

/**
 * 민감도 표 — 1·2·4·8틱을 한 번에.
 *
 * 관문이 이 표에서 가혹 조건 줄을 뽑아 본다.
 */
export function sensitivityTable(
  kind: InstrumentKind,
  tickSize: number,
): SlippageCase[] {
  return SENSITIVITY_TICKS.map((ticks) => ({
    ticks,
    roundTripPoints: roundTripSlippagePoints(ticks, tickSize),
    harsh: ticks === HARSH_TICKS[kind],
  }))
}

/** 실측 스프레드에서 뽑은 「보통」 틱 수. 시간대 중앙값들의 중앙값 */
export function typicalTicks(stats: readonly SpreadStat[], params: SlippageParams): number {
  if (stats.length === 0) return params.fallbackTicks
  return median(stats.map((s) => s.medianTicks))
}

/** 가정값으로 떨어진 비율. 높으면 그 성적은 실측이 아니라 우리가 정한 숫자다 */
export function fallbackRatio(stats: readonly SpreadStat[]): number {
  const total = stats.reduce((sum, s) => sum + s.sampleCount + s.fallbackCount, 0)
  if (total === 0) return 1
  return stats.reduce((sum, s) => sum + s.fallbackCount, 0) / total
}
