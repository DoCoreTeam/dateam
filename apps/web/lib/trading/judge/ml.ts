/**
 * `ml` 기준선 판단기 — **Jev 가 이것보다 나은가를 재는 자** (명세 §7.2 · §13.5)
 *
 * ## 왜 필요한가
 *
 * 「Jev 의 기대값이 +0.2R 이다」는 그 자체로는 아무 뜻이 없다. 지표 몇 개로 만든
 * 가벼운 모델도 +0.25R 이 나온다면 Jev 를 쓸 이유가 없고, 호출 비용만 더 든다.
 * 관문(§13.5)이 「선택한 판단기가 다른 판단기보다 나은가」를 묻는 이유가 이것이다.
 *
 * ## 왜 로지스틱인가
 *
 * 파라미터가 적어 적은 표본에서도 안 무너지고, **기준선은 이기기 쉬워야 뜻이 있다** —
 * 기준선을 복잡하게 만들면 Jev 가 못 이겨도 그것이 Jev 탓인지 기준선이 과적합한
 * 탓인지 알 수 없다.
 *
 * ## 같은 인터페이스, 특권 없음
 *
 * `rule`·`jev` 와 같은 꼴이고 밖으로 안 나간다(`external: false`).
 */

import type { Judge, JudgeInput, JudgeResult, RawScore } from './types.ts'

/** 지표를 모델 입력으로. **전부 ATR 로 나눈 상대값**이라 가격 수준이 달라도 같은 자다 */
export function featuresOf(input: JudgeInput): number[] | null {
  const { atr, smaFast, smaSlow, recentHigh, recentLow } = input.indicators
  const last = input.bars[input.bars.length - 1]
  if (!last || !(atr > 0)) return null
  return [
    (last.close - smaFast) / atr,
    (smaFast - smaSlow) / atr,
    (last.close - recentHigh) / atr,
    (last.close - recentLow) / atr,
    // 방향을 모델이 알아야 롱·숏을 한 벌로 배울 수 있다
    input.trigger.direction === 'long' ? 1 : -1,
  ]
}

export interface MlWeights {
  /** `featuresOf` 순서와 같은 길이 */
  weights: number[]
  bias: number
}

export const ML_FEATURE_COUNT = 5

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/** 조건 방향으로 갈 확률 */
export function predict(model: MlWeights, features: readonly number[]): number {
  const z = features.reduce((acc, f, i) => acc + f * (model.weights[i] ?? 0), model.bias)
  return sigmoid(z)
}

export interface MlSample {
  features: number[]
  win: boolean
}

/**
 * 학습 — 경사 하강 로지스틱.
 *
 * **학습 구간 자료로만** 부른다. 부르는 쪽이 그것을 지킨다(§13.3).
 * 표본이 모자라거나 한쪽 답만 있으면 null — 억지로 맞추면 늘 같은 답을 하는 모델이 나온다.
 */
export function fitMl(
  samples: readonly MlSample[],
  options: { iterations?: number; learningRate?: number; l2?: number } = {},
): MlWeights | null {
  if (samples.length < ML_FEATURE_COUNT * 2) return null
  const wins = samples.filter((s) => s.win).length
  if (wins === 0 || wins === samples.length) return null

  const iterations = options.iterations ?? 1_500
  const lr = options.learningRate ?? 0.05
  // 정칙화를 둔다. 기준선이 과적합하면 Jev 비교 자체가 뜻을 잃는다
  const l2 = options.l2 ?? 0.01

  const weights = new Array<number>(ML_FEATURE_COUNT).fill(0)
  let bias = 0

  for (let step = 0; step < iterations; step += 1) {
    const grad = new Array<number>(ML_FEATURE_COUNT).fill(0)
    let gradBias = 0
    for (const sample of samples) {
      const p = predict({ weights, bias }, sample.features)
      const d = p - (sample.win ? 1 : 0)
      for (let i = 0; i < ML_FEATURE_COUNT; i += 1) grad[i] += d * (sample.features[i] ?? 0)
      gradBias += d
    }
    for (let i = 0; i < ML_FEATURE_COUNT; i += 1) {
      weights[i] -= lr * (grad[i] / samples.length + l2 * weights[i])
    }
    bias -= (lr * gradBias) / samples.length
  }
  return { weights, bias }
}

/**
 * 조건 방향 확률을 원점수 꼴로.
 *
 * ## 「롱이 아닐 것 같다」는 「숏일 것 같다」가 아니다
 *
 * 조건이 롱을 가리켰는데 모델이 안 믿는다면, 그것은 **관망**이지 숏이 아니다.
 * 남은 확률을 롱·숏에 반씩 나누면 롱을 안 믿을수록 숏 확률이 올라가고,
 * 아무도 숏이라고 말한 적이 없는데 숏 신호가 나간다.
 * 그래서 남은 몫은 대부분 `hold` 로 간다.
 *
 * ## 왜 상한이 있나
 *
 * 0.05~0.80 으로 눌러 둔다. 1.0 에 붙으면 보정 곡선의 꼬리 구간에 표본이 안 쌓이고,
 * 그러면 정작 확신이 높은 신호의 확률을 아무도 못 맞춘다.
 */
export function scoreFrom(direction: 'long' | 'short', probability: number): RawScore {
  const p = Math.max(0, Math.min(1, probability))
  const directional = 0.05 + 0.75 * p
  const rest = 1 - directional
  const hold = rest * 0.8
  const opposite = rest * 0.2
  return direction === 'long'
    ? { p_long: directional, p_short: opposite, p_hold: hold, enter_now: p }
    : { p_long: opposite, p_short: directional, p_hold: hold, enter_now: p }
}

export const ML_SPEC = 'ml-v1'

export function createMlJudge(model: MlWeights | null): Judge {
  return {
    name: 'ml',
    // 지표만 보고 답한다. 밖으로 안 나가므로 요청·응답 시각이 없다
    external: false,
    modelVersion: ML_SPEC,
    async judge(input: JudgeInput): Promise<JudgeResult> {
      if (!model) return { status: 'abstain', abstainReason: 'no_model' }
      const features = featuresOf(input)
      if (!features) return { status: 'abstain', abstainReason: 'atr_zero' }
      return { status: 'completed', rawScore: scoreFrom(input.trigger.direction, predict(model, features)) }
    },
  }
}
