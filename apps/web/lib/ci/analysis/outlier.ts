// lib/ci/analysis/outlier.ts — 평소 대비 배수·백분위 산출 (순수 함수)
// 설계: 02-ucm-and-connectors.md §2
//
// DB를 모른다. 숫자만 받아 판정한다 — 그래야 규칙을 테스트로 못 박을 수 있다.

import {
  OUTLIER_MIN_BASELINE, PERCENTILE_MIN_POPULATION, judgeConfidence,
} from '../format/metrics.ts'
import type { CiComparability, CiConfidence } from '../types.ts'

export function median(values: readonly number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid]
}

export interface OutlierInput {
  /** 대상 콘텐츠의 조회수 */
  views: number | null
  /** 같은 채널·같은 포맷의 비교군 조회수 */
  baselineViews: readonly number[]
}

export interface OutlierResult {
  index: number | null
  baselineN: number
}

/**
 * 배수 = 대상 조회수 / 비교군 중앙값.
 * 표본이 8개 미만이면 산출하지 않는다 — 우연을 배수로 파는 것을 막는다.
 */
export function computeOutlierIndex(input: OutlierInput): OutlierResult {
  const baselineN = input.baselineViews.filter((v) => Number.isFinite(v) && v > 0).length
  if (input.views == null || !Number.isFinite(input.views)) return { index: null, baselineN }
  if (baselineN < OUTLIER_MIN_BASELINE) return { index: null, baselineN }

  const base = median(input.baselineViews.filter((v) => v > 0))
  if (base == null || base <= 0) return { index: null, baselineN }

  return { index: Math.round((input.views / base) * 100) / 100, baselineN }
}

/**
 * 백분위. 값이 클수록 상위이므로 "상위 N%"로 뒤집어 돌려준다.
 * 모집단 30 미만이면 산출하지 않는다.
 */
export function computeTopPercentile(
  value: number | null,
  population: readonly number[],
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const pool = population.filter((v) => Number.isFinite(v))
  if (pool.length < PERCENTILE_MIN_POPULATION) return null

  const below = pool.filter((v) => v < value).length
  const percentileFromBottom = (below / pool.length) * 100
  const top = 100 - percentileFromBottom
  return Math.round(top * 10) / 10
}

export interface VelocityPoint {
  capturedAt: string
  views: number | null
}

/**
 * 시간당 조회 속도. 스냅샷 2점 이상일 때만 산출한다.
 * 1점으로 "게시 이후 평균"을 내면 오래된 콘텐츠가 부당하게 낮게 나온다.
 */
export function computeVelocityPerHour(points: readonly VelocityPoint[]): number | null {
  const valid = points
    .filter((p) => p.views != null && Number.isFinite(p.views))
    .map((p) => ({ t: Date.parse(p.capturedAt), v: p.views as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)

  if (valid.length < 2) return null

  const first = valid[0]
  const last = valid[valid.length - 1]
  const hours = (last.t - first.t) / 3_600_000
  if (hours <= 0) return null

  const delta = last.v - first.v
  if (delta < 0) return null            // 조회수 감소는 이상치 — 속도로 환산하지 않는다

  return Math.round((delta / hours) * 100) / 100
}

export interface DerivedResult {
  outlierIndex: number | null
  outlierBaselineN: number
  topicPercentile: number | null
  velocityPerHour: number | null
  confidence: CiConfidence
}

/** 파생값을 한 번에 계산한다. 저장 형태와 1:1로 맞춘다. */
export function computeAll(input: {
  views: number | null
  baselineViews: readonly number[]
  topicPopulation: readonly number[]
  snapshots: readonly VelocityPoint[]
  completeness: number
  comparability: CiComparability | null
}): DerivedResult {
  const { index, baselineN } = computeOutlierIndex({
    views: input.views, baselineViews: input.baselineViews,
  })

  return {
    outlierIndex: index,
    outlierBaselineN: baselineN,
    topicPercentile: computeTopPercentile(input.views, input.topicPopulation),
    velocityPerHour: computeVelocityPerHour(input.snapshots),
    confidence: judgeConfidence({
      baselineN,
      completeness: input.completeness,
      comparability: input.comparability,
    }),
  }
}
