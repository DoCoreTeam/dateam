/**
 * 가중치 보정 (설계서 3.10.5)
 *
 * ## 표본이 적으면 보정이 과적합이다
 *
 * 다섯 건 보고 가중치를 고치면 그 다섯 건에만 맞는 값이 나온다.
 * 그리고 그 값으로 다음 사업을 판정한다 — **적은 데이터로 고친 것이
 * 안 고친 것보다 나쁘다.** 그래서 50건 미만이면 아예 안 건드린다.
 *
 * ## 고쳐도 나아지지 않으면 안 쓴다
 *
 * 보정한 가중치가 옛 가중치보다 판정을 못 맞히는 일이 실제로 있다.
 * 그래서 **보정 전후를 같은 표본으로 재서** 나아졌을 때만 채택한다.
 */

import { SOFT_WEIGHTS, softScore, FULL_SCORE_MIN, type SoftInputs } from '../fit/assess.ts'
import { usableSamples, type JudgedCase } from './outcomes.ts'

/** 이보다 표본이 적으면 보정하지 않는다 */
export const MIN_CALIBRATION_SAMPLES = 50
/** 이만큼은 나아져야 채택한다 */
export const MIN_IMPROVEMENT = 0.02

export type WeightKey = keyof typeof SOFT_WEIGHTS

export interface CalibrationSample {
  parts: Record<WeightKey, number>
  /** 실제로 따냈나 */
  won: boolean
}

export interface CalibrationResult {
  adopted: boolean
  reason: 'insufficient_samples' | 'no_improvement' | 'adopted'
  weights: Record<WeightKey, number>
  baselineAccuracy: number
  calibratedAccuracy: number
  sampleSize: number
}

/**
 * 표본으로 가중치를 고친다.
 *
 * 로지스틱 회귀 대신 **항목별 상관**으로 조정한다. 이유는 둘이다.
 * ① 표본 50건에 5개 변수는 회귀가 흔들린다
 * ② 결과를 사람이 읽을 수 있어야 한다 — 「실적 가중치를 25 에서 30 으로 올렸다」
 */
export function calibrate(samples: readonly CalibrationSample[]): CalibrationResult {
  const base = { ...SOFT_WEIGHTS } as Record<WeightKey, number>

  if (samples.length < MIN_CALIBRATION_SAMPLES) {
    // 적은 데이터로 고친 것이 안 고친 것보다 나쁘다
    return {
      adopted: false, reason: 'insufficient_samples', weights: base,
      baselineAccuracy: 0, calibratedAccuracy: 0, sampleSize: samples.length,
    }
  }

  const keys = Object.keys(base) as WeightKey[]
  const next = { ...base }

  for (const k of keys) {
    const corr = pointBiserial(samples.map((s) => s.parts[k] ?? 0), samples.map((s) => s.won))
    if (corr === null) continue
    // 상관이 큰 항목은 힘을 더 주고 작은 항목은 뺀다. 부호는 그대로 둔다
    const sign = base[k] < 0 ? -1 : 1
    const scaled = Math.abs(base[k]) * (1 + corr * CALIBRATION_STRENGTH)
    next[k] = Math.round(sign * clamp(scaled, Math.abs(base[k]) * 0.5, Math.abs(base[k]) * 1.5))
  }

  const baselineAccuracy = accuracy(samples, base)
  const calibratedAccuracy = accuracy(samples, next)

  // 보정한 것이 옛 가중치보다 못 맞히는 일이 실제로 있다
  if (calibratedAccuracy - baselineAccuracy < MIN_IMPROVEMENT) {
    return {
      adopted: false, reason: 'no_improvement', weights: base,
      baselineAccuracy, calibratedAccuracy, sampleSize: samples.length,
    }
  }

  return {
    adopted: true, reason: 'adopted', weights: next,
    baselineAccuracy, calibratedAccuracy, sampleSize: samples.length,
  }
}

/** 조정 폭 — 크면 표본에 휘둘린다 */
export const CALIBRATION_STRENGTH = 0.5

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** 점수와 이진 결과의 상관 -1~1. 값이 다 같으면 null */
export function pointBiserial(values: readonly number[], flags: readonly boolean[]): number | null {
  const n = values.length
  if (n === 0 || n !== flags.length) return null
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  if (sd === 0) return null

  const wonVals = values.filter((_, i) => flags[i])
  const lostVals = values.filter((_, i) => !flags[i])
  if (wonVals.length === 0 || lostVals.length === 0) return null

  const m1 = wonVals.reduce((a, b) => a + b, 0) / wonVals.length
  const m0 = lostVals.reduce((a, b) => a + b, 0) / lostVals.length
  const p = wonVals.length / n
  return ((m1 - m0) / sd) * Math.sqrt(p * (1 - p))
}

/** 이 가중치로 판정하면 얼마나 맞히나 */
export function accuracy(samples: readonly CalibrationSample[], weights: Record<WeightKey, number>): number {
  if (samples.length === 0) return 0
  let hit = 0
  for (const s of samples) {
    // parts 는 이미 기본 가중치가 곱해진 값이라 비율로 되돌려 새 가중치를 곱한다
    let total = 0
    for (const k of Object.keys(weights) as WeightKey[]) {
      const baseW: number = SOFT_WEIGHTS[k]
      const ratio = baseW === 0 ? 0 : (s.parts[k] ?? 0) / baseW
      total += ratio * weights[k]
    }
    const predicted = Math.min(100, Math.max(0, total)) >= FULL_SCORE_MIN
    if (predicted === s.won) hit++
  }
  return hit / samples.length
}

/** 판정 표본을 보정 표본으로 */
export function toCalibrationSamples(cases: readonly JudgedCase[]): CalibrationSample[] {
  return usableSamples(cases).map((c) => ({
    parts: c.parts as Record<WeightKey, number>,
    won: c.result === 'won',
  }))
}

// 사용자 수정 이력

export interface UserCorrection {
  /** 사용자가 고친 자리 */
  fieldPath: string
  /** 어느 벤더 값을 버렸나 */
  rejectedVendor: string | null
  /** 어느 벤더 값을 골랐나 */
  chosenVendor: string | null
  /** 요건 매핑을 고쳤으면 그 짝 */
  mapping: { requirementText: string; type: string } | null
}

/**
 * 사용자가 고른 벤더에 힘을 더 준다.
 *
 * 가중치는 **0.5~2.0 안에서만** 움직인다. 한 사용자가 몇 번 고른 것으로
 * 한 벤더가 아예 안 쓰이게 되면 그 벤더가 잘하는 자리까지 잃는다.
 */
export function updateVendorWeights(
  current: Readonly<Record<string, number>>,
  corrections: readonly UserCorrection[],
): Record<string, number> {
  const next: Record<string, number> = { ...current }
  for (const c of corrections) {
    if (c.chosenVendor) next[c.chosenVendor] = clamp((next[c.chosenVendor] ?? 1) + VENDOR_STEP, 0.5, 2)
    if (c.rejectedVendor) next[c.rejectedVendor] = clamp((next[c.rejectedVendor] ?? 1) - VENDOR_STEP, 0.5, 2)
  }
  return next
}

export const VENDOR_STEP = 0.05

/** 요건 매핑 사전을 갱신한다 — 사람이 고친 짝이 다음부터 자동으로 잡힌다 */
export function updateMappingDictionary(
  current: Readonly<Record<string, string>>,
  corrections: readonly UserCorrection[],
): Record<string, string> {
  const next: Record<string, string> = { ...current }
  for (const c of corrections) {
    if (!c.mapping) continue
    const key = c.mapping.requirementText.replace(/\s/g, '').slice(0, 80)
    if (key) next[key] = c.mapping.type
  }
  return next
}
