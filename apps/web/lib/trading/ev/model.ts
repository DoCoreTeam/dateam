/**
 * 기대값 평균표 — **비슷한 과거 신호의 실제 순손익 평균** (명세 §7.5)
 *
 * ## 왜 공식이 아니라 평균표인가 (D-10)
 *
 * `승률 × 목표 − (1−승률) × 손절` 같은 공식은 **청산이 목표 아니면 손절일 때만** 맞는다.
 * 실제로는 시간 청산과 당일 청산이 섞이고, 그 둘의 손익은 공식 어디에도 안 들어간다.
 * 그래서 공식을 안 쓰고 **실제로 그렇게 끝난 거래들의 평균**을 쓴다 —
 * 그러면 청산 방식이 몇 가지든 계산이 어긋나지 않는다.
 *
 * ## 왜 학습 구간만인가 (D-35)
 *
 * 검증 구간 자료로 평균표를 만들면, 그 평균표로 검증 구간을 평가할 때
 * **자기 답을 보고 푸는 것**이 된다. 성적은 늘 좋게 나오고 실전에서 안 재현된다.
 *
 * ## 비용은 이미 들어 있다 (D-34)
 *
 * 여기 들어오는 순손익은 체결 재현이 비용을 뺀 값이다. 신호 규칙(SR-01)에서
 * 또 빼면 이중 차감이 된다. SR-12 가 비용을 빼기 **전**의 가격 거리를 보는 것과 다르다.
 */

export type Direction = 'long' | 'short'

export interface EvSample {
  /** 보정된 확률 */
  calibratedProb: number
  /** 비용을 이미 뺀 순손익(R) */
  netPnlR: number
  /** 어느 구간 자료인가. train 이 아니면 평균표에 못 들어간다 */
  windowKind: 'train' | 'validate' | 'lockbox'
}

export interface EvBucket {
  from: number
  to: number
  sampleCount: number
  /** 표본이 없으면 null — **값을 지어내지 않는다** */
  meanNetPnlR: number | null
}

export interface EvModel {
  version: string
  judge: string
  direction: Direction
  buckets: EvBucket[]
  trainFrom: string
  trainTo: string
}

export type EvRejection = { reason: string; userMessage: string }

/**
 * 평균표를 만든다.
 *
 * **학습 구간 아닌 표본이 하나라도 있으면 거부한다.** 걸러 내고 조용히 만들면
 * 「걸러졌겠지」라는 짐작 위에 평균표가 서고, 어느 날 그 짐작이 틀린다.
 */
export function buildEvModel(input: {
  samples: readonly EvSample[]
  version: string
  judge: string
  direction: Direction
  trainFrom: string
  trainTo: string
  bucketCount?: number
}): { model: EvModel } | { rejection: EvRejection } {
  const leaked = input.samples.filter((s) => s.windowKind !== 'train')
  if (leaked.length > 0) {
    return {
      rejection: {
        reason: `non_train_samples:${leaked.length}`,
        userMessage: '학습 구간이 아닌 자료가 섞여 있습니다. 그 평균표로 검증하면 자기 답을 보고 푸는 것이 됩니다',
      },
    }
  }
  if (input.samples.length === 0) {
    return { rejection: { reason: 'no_samples', userMessage: '평균표를 만들 표본이 없습니다' } }
  }

  const bucketCount = input.bucketCount ?? 10
  const buckets: EvBucket[] = []
  for (let i = 0; i < bucketCount; i += 1) {
    const from = i / bucketCount
    const to = (i + 1) / bucketCount
    const inBucket = input.samples.filter((s) =>
      s.calibratedProb >= from && (i === bucketCount - 1 ? s.calibratedProb <= to : s.calibratedProb < to))
    buckets.push({
      from,
      to,
      sampleCount: inBucket.length,
      meanNetPnlR: inBucket.length > 0
        ? inBucket.reduce((acc, s) => acc + s.netPnlR, 0) / inBucket.length
        : null,
    })
  }

  return {
    model: {
      version: input.version,
      judge: input.judge,
      direction: input.direction,
      buckets,
      trainFrom: input.trainFrom,
      trainTo: input.trainTo,
    },
  }
}

/**
 * 이 확률의 기대값은 얼마인가.
 *
 * 표본이 없는 구간이면 **null 이고, 그때는 신호를 안 낸다** —
 * 「모름」을 0 으로 읽으면 기대값 0 짜리 신호가 기준을 넘는 날이 온다.
 */
export function expectedValueFor(
  model: EvModel,
  calibratedProb: number,
  minSamples = 1,
): { value: number; sampleCount: number } | null {
  const bucket = model.buckets.find((b) =>
    calibratedProb >= b.from && (b.to >= 1 ? calibratedProb <= b.to : calibratedProb < b.to))
  if (!bucket || bucket.meanNetPnlR === null || bucket.sampleCount < minSamples) return null
  return { value: bucket.meanNetPnlR, sampleCount: bucket.sampleCount }
}

/**
 * 신호 규칙 SR-01 — 순기대값이 최소값 이상인가.
 *
 * **여기서 비용을 또 빼지 않는다.** 들어온 값에 이미 들어 있다(D-34).
 */
export function meetsMinimumEv(
  ev: { value: number } | null,
  minimumR: number,
): { ok: true } | { ok: false; reason: string } {
  if (!ev) return { ok: false, reason: 'no_ev_for_bucket' }
  if (ev.value < minimumR) return { ok: false, reason: `ev_below_minimum:${ev.value.toFixed(4)}<${minimumR}` }
  return { ok: true }
}

/** 구간별 표본 수. 화면이 「어디가 비었나」를 말할 수 있게 */
export function coverage(model: EvModel): { filled: number; empty: number; total: number } {
  const filled = model.buckets.filter((b) => b.sampleCount > 0).length
  return { filled, empty: model.buckets.length - filled, total: model.buckets.length }
}
