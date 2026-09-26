/**
 * 원점수를 확률로 바꾸는 규칙 — **순수하게**
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * 보정(`applyPlatt`)과 기대값(`expectedValueFor`)은 1-B 때 다 만들었는데
 * **검증 파이프라인 안에서만 불렸다.** 실시간 경로(`tick` → `emitSignal`)는
 * `calibratedProb: null` 을 손으로 적어 넘기고 있었다(실측 2026-09-26).
 *
 * 그 말은 `trading_calibrations` 에 줄이 생겨도 신호는 **영영 안 나간다**는 뜻이다.
 * 「보정이 아직 없어서 안 나간다」와 「읽는 코드가 없어서 안 나간다」는 다른 사실이고,
 * 앞의 것은 기다리면 풀리지만 뒤의 것은 기다려도 안 풀린다.
 *
 * ## 방향마다 따로 보정한다 (§7.4 D-09)
 *
 * 실제로 하는 행동은 **고른 방향 하나로 진입하는 것뿐**이다. 그래서 롱 신호는 `p_long` 을,
 * 숏 신호는 `p_short` 를 각자의 모델로 보정한다. 하나로 합치면 롱이 잘 맞고 숏이 안 맞는
 * 날에도 가운데 값이 나와 둘 다 그럭저럭 맞는 것처럼 보인다.
 */

import { applyPlatt, type PlattParams } from '../calibrate/platt.ts'
import { expectedValueFor, type EvModel, type Direction } from '../ev/model.ts'
import type { RawScore } from '../judge/types.ts'

export type { Direction }

/**
 * 원점수에서 방향을 고른다.
 *
 * **관망이 가장 높으면 방향이 없다**(§7.4 D-09) — 기권이다.
 * 여기서 억지로 롱이나 숏을 고르면 판단기가 「모르겠다」고 한 것을 우리가 뒤집는 것이 된다.
 */
export function directionOf(score: RawScore | null): Direction | null {
  if (!score) return null
  const { p_long: long, p_short: short, p_hold: hold } = score
  if (![long, short, hold].every((v) => Number.isFinite(v))) return null
  if (hold >= long && hold >= short) return null
  return long > short ? 'long' : 'short'
}

/** 고른 방향의 원점수 */
export function scoreForDirection(score: RawScore, direction: Direction): number {
  return direction === 'long' ? score.p_long : score.p_short
}

/**
 * DB JSONB 에서 읽은 것이 정말 Platt 파라미터인가.
 *
 * **우리가 쓴 값이라도 검사한다.** 판이 바뀌거나 손으로 고친 줄이 섞이면
 * `a` 가 문자열일 수 있고, 그러면 `Math.exp` 가 `NaN` 을 내고 `NaN` 은
 * 비교에서 전부 거짓이라 **조용히 신호가 안 나간다.** 사유 없이 안 나가는 것이 제일 나쁘다.
 */
export function plattParamsFrom(raw: unknown): PlattParams | null {
  if (!raw || typeof raw !== 'object') return null
  const a = (raw as Record<string, unknown>).a
  const b = (raw as Record<string, unknown>).b
  if (!Number.isFinite(a as number) || !Number.isFinite(b as number)) return null
  return { a: a as number, b: b as number }
}

export interface SignalModels {
  direction: Direction
  calibration: { params: PlattParams; version: string } | null
  ev: { model: EvModel; version: string } | null
  /** SR-02 가 보는 `enter_now` 도 같은 모델로 보정한다 */
  enterNowCalibration: { params: PlattParams; version: string } | null
}

export interface ProbabilityResult {
  direction: Direction | null
  calibratedProb: number | null
  enterNowProb: number | null
  netExpectedValueR: number | null
  calibrationVersion: string | null
  evModelVersion: string | null
  /** 어디서 멈췄나. 실행 기록에 실려 「왜 신호가 안 났나」를 답한다 */
  stoppedAt: 'no_score' | 'hold_dominant' | 'no_calibration' | 'no_ev_bucket' | null
}

/** 아무것도 못 구한 답. 멈춘 자리만 다르다 */
function stopped(at: ProbabilityResult['stoppedAt'], direction: Direction | null = null): ProbabilityResult {
  return {
    direction,
    calibratedProb: null,
    enterNowProb: null,
    netExpectedValueR: null,
    calibrationVersion: null,
    evModelVersion: null,
    stoppedAt: at,
  }
}

/**
 * 원점수 → 방향 → 보정 확률 → 기대값. **순서가 정해져 있다**(M2).
 *
 * 한 단계라도 못 하면 뒤는 안 한다. 보정 없이 기대값을 찾으면 원점수를 확률로 쓰는 것이고,
 * 원점수는 확률이 아니다(M3).
 */
export function probabilitiesFrom(
  score: RawScore | null,
  models: SignalModels | null,
  minEvSamples = 1,
): ProbabilityResult {
  if (!score) return stopped('no_score')
  const direction = directionOf(score)
  if (!direction) return stopped('hold_dominant')
  if (!models || models.direction !== direction || !models.calibration) {
    return stopped('no_calibration', direction)
  }

  const calibratedProb = applyPlatt(models.calibration.params, scoreForDirection(score, direction))
  const enterNowProb = models.enterNowCalibration && Number.isFinite(score.enter_now)
    ? applyPlatt(models.enterNowCalibration.params, score.enter_now)
    : null

  const ev = models.ev
    ? expectedValueFor(models.ev.model, calibratedProb, minEvSamples)
    : null

  return {
    direction,
    calibratedProb,
    enterNowProb,
    netExpectedValueR: ev ? ev.value : null,
    calibrationVersion: models.calibration.version,
    evModelVersion: ev ? models.ev!.version : null,
    // 보정까지는 됐는데 기대값 구간이 비었으면 그 사실을 남긴다
    stoppedAt: ev ? null : 'no_ev_bucket',
  }
}
