/**
 * 보정이 쓸 만한가 — **Brier 와 보정 곡선** (명세 §7.4)
 *
 * 확률을 내놓는 것과 그 확률이 맞는 것은 다른 일이다. 「70% 라고 말한 것들 중
 * 실제로 70% 가 이겼나」를 봐야 하고, 그것을 두 가지로 본다.
 *
 *   · **Brier** — 확률과 실제의 제곱 오차 평균. 작을수록 좋다
 *   · **보정 곡선** — 확률 구간별 실제 승률. 오름차순이어야 한다
 *
 * 기저율(항상 평균 승률을 답하는 모델)보다 나쁘면 그 보정은 아무 정보도 안 준다.
 */

export interface ProbabilityOutcome {
  prob: number
  win: boolean
}

/** 제곱 오차 평균. 표본이 없으면 null — 0 은 「완벽하다」는 뜻이라 쓰면 안 된다 */
export function brierScore(outcomes: readonly ProbabilityOutcome[]): number | null {
  if (outcomes.length === 0) return null
  const sum = outcomes.reduce((acc, o) => {
    const actual = o.win ? 1 : 0
    return acc + (o.prob - actual) ** 2
  }, 0)
  return sum / outcomes.length
}

/** 항상 평균 승률을 답하는 모델의 Brier. 이것보다 나빠야 할 이유가 없다 */
export function baseRateBrier(outcomes: readonly ProbabilityOutcome[]): number | null {
  if (outcomes.length === 0) return null
  const rate = outcomes.filter((o) => o.win).length / outcomes.length
  return outcomes.reduce((acc, o) => acc + (rate - (o.win ? 1 : 0)) ** 2, 0) / outcomes.length
}

export interface ReliabilityBucket {
  from: number
  to: number
  /** 이 구간이라고 말한 횟수 */
  count: number
  /** 그중 실제로 이긴 비율. 표본이 없으면 null — 0 으로 채우면 「다 졌다」가 된다 */
  actualRate: number | null
  /** 이 구간에서 말한 확률의 평균 */
  meanProb: number | null
}

/** 보정 곡선 — 확률 구간별 실제 승률 */
export function reliabilityCurve(
  outcomes: readonly ProbabilityOutcome[],
  bucketCount: number,
): ReliabilityBucket[] {
  const buckets: ReliabilityBucket[] = []
  for (let i = 0; i < bucketCount; i += 1) {
    const from = i / bucketCount
    const to = (i + 1) / bucketCount
    const inBucket = outcomes.filter((o) =>
      o.prob >= from && (i === bucketCount - 1 ? o.prob <= to : o.prob < to))
    buckets.push({
      from,
      to,
      count: inBucket.length,
      actualRate: inBucket.length > 0 ? inBucket.filter((o) => o.win).length / inBucket.length : null,
      meanProb: inBucket.length > 0 ? inBucket.reduce((a, o) => a + o.prob, 0) / inBucket.length : null,
    })
  }
  return buckets
}

/**
 * 구간 승률이 오름차순인가 (§13.5 관문).
 *
 * 표본이 없는 구간은 **건너뛴다** — 없는 값을 0 으로 읽으면 곡선이 내려간 것처럼 보인다.
 */
export function isMonotonic(buckets: readonly ReliabilityBucket[]): boolean {
  const rates = buckets.filter((b) => b.actualRate !== null).map((b) => b.actualRate as number)
  for (let i = 1; i < rates.length; i += 1) {
    if (rates[i] < rates[i - 1]) return false
  }
  return true
}

export interface CalibrationVerdict {
  brier: number | null
  baseRate: number | null
  /** 기저율보다 나은가 */
  betterThanBaseRate: boolean
  monotonic: boolean
  buckets: ReliabilityBucket[]
  /** 판정할 표본이 모자란가. 「나쁨」과 「아직 못 잼」은 다른 상태다 */
  insufficient: boolean
}

export function judgeCalibration(
  outcomes: readonly ProbabilityOutcome[],
  options: { bucketCount?: number; minSamples?: number } = {},
): CalibrationVerdict {
  const bucketCount = options.bucketCount ?? 10
  const minSamples = options.minSamples ?? 100
  const brier = brierScore(outcomes)
  const base = baseRateBrier(outcomes)
  const buckets = reliabilityCurve(outcomes, bucketCount)
  return {
    brier,
    baseRate: base,
    betterThanBaseRate: brier !== null && base !== null && brier < base,
    monotonic: isMonotonic(buckets),
    buckets,
    insufficient: outcomes.length < minSamples,
  }
}
