/**
 * 보정 — **원점수를 확률로 옮긴다** (명세 §7.4 · M3)
 *
 * ## 왜 필요한가
 *
 * 판단기가 내놓는 0.72 는 확률이 아니다. 「그 판단기가 0.72 라고 말한 과거 신호들 중
 * 실제로 이익이 난 비율」이 확률이고, 둘은 전혀 다른 숫자다.
 * 보정이 없으면 기대값을 계산할 수 없고, 그래서 **보정이 없으면 신호를 안 낸다**(M3).
 *
 * ## 왜 방향별로 따로 하나 (D-09)
 *
 * 실제로 하는 행동은 **고른 방향 하나로 진입하는 것**뿐이다. 롱 신호에는 `p_long` 을,
 * 숏 신호에는 `p_short` 를 「청산 계획대로 했을 때 순이익 > 0 이었나」로 보정한다.
 * 한 벌로 합치면 롱이 잘 되는 장에서 숏 확률까지 높게 나온다.
 *
 * ## 왜 Platt 이 기본인가 (D-42)
 *
 * 파라미터가 둘뿐이라 표본이 적을 때 가장 안정적이다. 등위 회귀는 표본이 충분할 때만
 * 후보로 본다 — 적은 표본에서는 훈련 자료를 외워 버린다.
 */

export interface LabeledScore {
  /** 판단기의 원점수 (0~1) */
  score: number
  /** 그 신호가 실제로 이익이었나 */
  win: boolean
}

export interface PlattParams {
  a: number
  b: number
}

/** 확률이 0 이나 1 에 딱 붙으면 로그가 무한이 된다. 양끝을 살짝 들여놓는다 */
const EPS = 1e-6

function clamp01(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p))
}

/** 로지스틱. `1 / (1 + exp(a·s + b))` — Platt 원논문의 부호 규약을 따른다 */
export function applyPlatt(params: PlattParams, score: number): number {
  return clamp01(1 / (1 + Math.exp(params.a * score + params.b)))
}

/**
 * 파라미터 둘을 맞춘다 (경사 하강).
 *
 * 표본이 없거나 한쪽 답만 있으면 **맞출 수 없다** — null 을 돌려준다.
 * 억지로 맞추면 「전부 이긴다」거나 「전부 진다」는 모델이 나오고, 그 확률로 신호를 낸다.
 */
export function fitPlatt(
  samples: readonly LabeledScore[],
  options: { iterations?: number; learningRate?: number } = {},
): PlattParams | null {
  if (samples.length < 2) return null
  const wins = samples.filter((s) => s.win).length
  if (wins === 0 || wins === samples.length) return null

  const iterations = options.iterations ?? 2_000
  const lr = options.learningRate ?? 0.1

  /**
   * 라벨을 살짝 들여놓는다(Platt 의 정칙화). 0/1 그대로 쓰면 분리 가능한 자료에서
   * 파라미터가 무한으로 달아나고, 그러면 확률이 전부 0 아니면 1 이 된다.
   */
  const nPos = wins
  const nNeg = samples.length - wins
  const tPos = (nPos + 1) / (nPos + 2)
  const tNeg = 1 / (nNeg + 2)

  let a = 0
  let b = 0
  for (let step = 0; step < iterations; step += 1) {
    let gradA = 0
    let gradB = 0
    for (const sample of samples) {
      const p = 1 / (1 + Math.exp(a * sample.score + b))
      const t = sample.win ? tPos : tNeg
      /**
       * `p = 1/(1 + e^z)` 라 `dp/dz` 가 음수다. 그래서 로그 손실의 기울기가
       * 흔히 보는 `(p - t)` 가 아니라 **`(t - p)`** 가 된다.
       */
      const d = t - p
      gradA += d * sample.score
      gradB += d
    }
    /**
     * **빼야 한다.** 더하면 손실을 키우는 쪽으로 가고, 확률이 양끝(0 또는 1)에 눌러붙는다 —
     * 실측: 점수를 0.15 로 넣으나 0.95 로 넣으나 0.000001 이 나왔다.
     */
    a -= (lr * gradA) / samples.length
    b -= (lr * gradB) / samples.length
  }
  return { a, b }
}

export type CalibrationMethod = 'platt' | 'isotonic'

/**
 * 어느 방법을 쓸까 (D-42).
 *
 * 등위 회귀는 표본이 충분할 때만 **후보**다. 적은 표본에서는 훈련 자료를 외워
 * 검증 구간에서 무너진다.
 */
export function chooseMethod(sampleCount: number, isotonicMinSamples: number): CalibrationMethod {
  return sampleCount >= isotonicMinSamples ? 'isotonic' : 'platt'
}

export interface FitInput {
  samples: readonly LabeledScore[]
  /** 학습 구간 */
  trainFrom: string
  trainTo: string
  /** 평가 구간. 학습과 겹치면 안 된다 */
  validateFrom: string
  validateTo: string
}

export type FitRejection = { reason: string; userMessage: string }

/**
 * 학습과 검증 구간이 쓸 만한가.
 *
 * **겹치면 거부한다.** 같은 자료로 맞추고 같은 자료로 평가하면 그 평가는
 * 자기 답을 보고 푼 것이고, 숫자는 늘 좋게 나온다.
 */
export function validateWindows(input: FitInput): FitRejection | null {
  if (input.trainTo >= input.validateFrom) {
    return {
      reason: `windows_overlap:${input.trainTo}>=${input.validateFrom}`,
      userMessage: '학습 구간이 검증 구간과 겹치거나 뒤에 있습니다. 같은 자료로 맞추고 평가하면 성적이 거짓이 됩니다',
    }
  }
  if (input.samples.length === 0) {
    return { reason: 'no_samples', userMessage: '보정할 표본이 없습니다' }
  }
  return null
}
