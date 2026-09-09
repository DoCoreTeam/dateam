/**
 * 이상 조항 통계 층 (설계서 3.8.3)
 *
 * ## 표본이 적으면 통계가 거짓말을 한다
 *
 * 공고 세 건을 보고 「이 조항은 드물다」고 말하면 그건 통계가 아니라 우연이다.
 * 그래서 표본이 모자라면 **층 자체를 끈다** — 「데이터가 부족하다」고 말하는 편이
 * 그럴듯한 숫자를 보여 주는 것보다 낫다.
 *
 * ## 통계는 «참고» 다
 *
 * 이 층이 혼자 잡은 것은 확정도 의심도 아니다. 「이 사업은 같은 유형 공고와 다르다」는
 * 사실일 뿐, 그것이 문제라는 뜻은 아니다. 등급 판정에서 참고로만 쓴다.
 */

/** 이보다 표본이 적으면 통계 층을 끈다 */
export const MIN_SAMPLE_SIZE = 20

export interface StatSample {
  /** 같은 유형(업종·규모)의 지난 공고들에서 잰 값 */
  values: number[]
}

export interface StatOutlier {
  metric: string
  value: number
  median: number
  /** 중앙값의 몇 배인가 */
  ratio: number
  sampleSize: number
}

export interface StatResult {
  enabled: boolean
  /** 왜 껐나 — 화면이 「데이터 부족」이라고 말할 수 있게 */
  disabledReason: 'insufficient_sample' | null
  outliers: StatOutlier[]
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = Array.from(values).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 중앙값의 이 배를 넘으면 튄 값으로 본다 */
export const OUTLIER_MULTIPLIER = 2

export interface MetricInput {
  metric: string
  value: number
  sample: StatSample
}

/**
 * 지난 공고와 견줘 튄 값을 찾는다.
 *
 * 표본이 모자라면 아무것도 찾지 않는다 — **빈 결과가 아니라 «껐다» 를 돌려준다.**
 * 빈 결과로 두면 화면이 「이상 없음」으로 그린다.
 */
export function findOutliers(inputs: readonly MetricInput[]): StatResult {
  const usable = inputs.filter((i) => i.sample.values.length >= MIN_SAMPLE_SIZE)
  if (usable.length === 0) {
    return { enabled: false, disabledReason: 'insufficient_sample', outliers: [] }
  }

  const outliers: StatOutlier[] = []
  for (const i of usable) {
    const m = median(i.sample.values)
    if (m === null || m <= 0) continue
    const ratio = i.value / m
    if (ratio > OUTLIER_MULTIPLIER) {
      outliers.push({ metric: i.metric, value: i.value, median: m, ratio, sampleSize: i.sample.values.length })
    }
  }
  return { enabled: true, disabledReason: null, outliers }
}
