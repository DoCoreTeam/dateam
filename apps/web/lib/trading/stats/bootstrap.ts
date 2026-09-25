/**
 * 신뢰구간 — **거래일 단위로 묶어 뽑는다** (명세 §13.4)
 *
 * ## 왜 거래 단위가 아니라 날 단위인가
 *
 * 같은 날 거래들은 서로 독립이 아니다. 그날 장이 한쪽으로 흐르면 그날 거래는
 * 다 같이 이기거나 다 같이 진다. 거래 단위로 다시 뽑으면 **표본이 실제보다 많은 척**
 * 하게 되고, 신뢰구간이 좁아져 「하한이 0보다 크다」가 쉽게 나온다 —
 * 그 관문은 통과했는데 실전에서 안 재현되는 전형적인 경로다.
 *
 * ## 왜 씨앗을 받나
 *
 * 부트스트랩은 무작위다. 같은 자료에 매번 다른 구간이 나오면 「어제는 통과했는데
 * 오늘은 아니다」가 되고, 그 숫자로는 아무것도 결정할 수 없다. 씨앗을 받아 재현한다.
 */

/** 거래 하나. 어느 날 것인지가 묶는 기준이다 */
export interface TradeOutcome {
  tradeDate: string
  netPnlR: number
}

/** 결정론적 난수 (mulberry32). 같은 씨앗에 같은 순서 */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 날짜별로 묶는다. 이 묶음이 다시 뽑기의 단위다 */
export function groupByDay(trades: readonly TradeOutcome[]): TradeOutcome[][] {
  const byDay = new Map<string, TradeOutcome[]>()
  for (const trade of trades) {
    const list = byDay.get(trade.tradeDate)
    if (list) list.push(trade)
    else byDay.set(trade.tradeDate, [trade])
  }
  return [...byDay.keys()].sort().map((day) => byDay.get(day) as TradeOutcome[])
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export interface ConfidenceInterval {
  estimate: number
  lower: number
  upper: number
  /** 몇 날을 썼나. 거래 수가 아니라 **날 수**가 실제 표본 크기다 */
  dayCount: number
  tradeCount: number
}

export interface BootstrapOptions {
  iterations?: number
  /** 0.95 면 2.5%~97.5% */
  level?: number
  seed?: number
}

/**
 * 거래당 기대값의 신뢰구간.
 *
 * **날을 통째로 다시 뽑는다** — 그날 거래 전부가 함께 들어가거나 함께 빠진다.
 * 표본이 모자라면 null: 날이 하나뿐이면 다시 뽑아도 늘 같은 자료라 구간이 0폭이 된다.
 */
export function bootstrapExpectancy(
  trades: readonly TradeOutcome[],
  options: BootstrapOptions = {},
): ConfidenceInterval | null {
  const days = groupByDay(trades)
  if (days.length < 2) return null

  const iterations = options.iterations ?? 2_000
  const level = options.level ?? 0.95
  const random = makeRandom(options.seed ?? 1)

  const estimate = mean(trades.map((t) => t.netPnlR))
  if (estimate === null) return null

  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const picked: number[] = []
    for (let d = 0; d < days.length; d += 1) {
      const day = days[Math.floor(random() * days.length)]
      for (const trade of day) picked.push(trade.netPnlR)
    }
    const m = mean(picked)
    if (m !== null) samples.push(m)
  }
  if (samples.length === 0) return null

  samples.sort((a, b) => a - b)
  const tail = (1 - level) / 2
  return {
    estimate,
    lower: samples[Math.floor(tail * (samples.length - 1))],
    upper: samples[Math.ceil((1 - tail) * (samples.length - 1))],
    dayCount: days.length,
    tradeCount: trades.length,
  }
}

/**
 * 두 판단기의 **차이**의 신뢰구간 (§13.4).
 *
 * 각각의 구간을 보고 겹치는지 눈으로 재면 안 된다 — 두 구간이 겹쳐도 차이는
 * 유의할 수 있고, 그 반대도 있다. **같은 날을 함께 다시 뽑아** 차이를 직접 잰다.
 */
export function bootstrapDifference(
  a: readonly TradeOutcome[],
  b: readonly TradeOutcome[],
  options: BootstrapOptions = {},
): ConfidenceInterval | null {
  const daysA = new Map(groupByDay(a).map((day) => [day[0].tradeDate, day]))
  const daysB = new Map(groupByDay(b).map((day) => [day[0].tradeDate, day]))
  // 두 판단기가 같은 날을 본 자료만 비교한다. 다른 날을 섞으면 장의 차이를 판단기 차이로 읽는다
  const shared = [...daysA.keys()].filter((d) => daysB.has(d)).sort()
  if (shared.length < 2) return null

  const iterations = options.iterations ?? 2_000
  const level = options.level ?? 0.95
  const random = makeRandom(options.seed ?? 1)

  const meanA = mean(a.filter((t) => daysB.has(t.tradeDate)).map((t) => t.netPnlR))
  const meanB = mean(b.filter((t) => daysA.has(t.tradeDate)).map((t) => t.netPnlR))
  if (meanA === null || meanB === null) return null

  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const pickedA: number[] = []
    const pickedB: number[] = []
    for (let d = 0; d < shared.length; d += 1) {
      const day = shared[Math.floor(random() * shared.length)]
      for (const t of daysA.get(day) ?? []) pickedA.push(t.netPnlR)
      for (const t of daysB.get(day) ?? []) pickedB.push(t.netPnlR)
    }
    const mA = mean(pickedA)
    const mB = mean(pickedB)
    if (mA !== null && mB !== null) samples.push(mA - mB)
  }
  if (samples.length === 0) return null

  samples.sort((x, y) => x - y)
  const tail = (1 - level) / 2
  return {
    estimate: meanA - meanB,
    lower: samples[Math.floor(tail * (samples.length - 1))],
    upper: samples[Math.ceil((1 - tail) * (samples.length - 1))],
    dayCount: shared.length,
    tradeCount: a.length + b.length,
  }
}

/**
 * A 가 B 보다 낫다고 말할 수 있나 (§13.4).
 *
 * 차이의 **하한이 0보다 크고**, 개선폭도 기준 이상이어야 한다.
 * 하한만 보면 +0.001R 짜리 차이로 「낫다」고 말하게 되고, 그 차이로는 아무것도 안 바뀐다.
 */
export function isBetterThan(
  difference: ConfidenceInterval | null,
  minimumImprovementR: number,
): { better: boolean; reason: string } {
  if (!difference) return { better: false, reason: 'not_enough_shared_days' }
  if (difference.lower <= 0) return { better: false, reason: `lower_not_positive:${difference.lower.toFixed(4)}` }
  if (difference.estimate < minimumImprovementR) {
    return { better: false, reason: `improvement_below_minimum:${difference.estimate.toFixed(4)}<${minimumImprovementR}` }
  }
  return { better: true, reason: `better_by:${difference.estimate.toFixed(4)}` }
}
