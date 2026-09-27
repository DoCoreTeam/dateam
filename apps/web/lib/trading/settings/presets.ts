/**
 * 고를 것 셋 — **숫자를 지어내지 않는다**
 *
 * ## 왜 필요했나
 *
 * 설정 92개 중 69개가 숫자이고, 화면은 빈칸만 줬다. 최솟값과 최댓값을 코드가 이미
 * 아는데도 그랬다 (사용자 지적 2026-09-27 「선택하는건 다 선택지를 줘야 하는거야」).
 *
 * ## 값을 어디서 가져오나
 *
 * **가운데 것만 근거가 있다.** 명세 §19 가 정한 기본값이다. 그래서 그것에만 권장을 붙인다.
 * 양쪽 둘은 기본값에서 한 걸음 적게·많게 간 값이고, 「이만큼이 보수적이다」 같은 판정을
 * 담지 않는다. 그 판정은 검증 표본이 쌓여야 할 수 있고, 지금 정하면 그 숫자가
 * 근거처럼 보인다.
 *
 * 그래서 이름도 「적게 · 기본 · 많게」다. 「보수 · 중립 · 적극」이 아니다.
 */

import type { TradingSetting } from './registry.ts'

export interface Preset {
  label: string
  value: number
  /** 명세가 정한 값인가. 이것에만 권장이 붙는다 */
  recommended: boolean
}

/** 기본값에서 한 걸음. 배수는 규칙이고 값이 아니다 */
const LESS = 0.5
const MORE = 1.5

function clamp(v: number, spec: TradingSetting): number {
  const lo = spec.min ?? Number.NEGATIVE_INFINITY
  const hi = spec.max ?? Number.POSITIVE_INFINITY
  return Math.min(hi, Math.max(lo, v))
}

/** 정수로 쓰던 값은 정수로 돌려준다. 봉 수가 3.5 가 되면 그 자리는 못 쓴다 */
function keepShape(base: number, v: number): number {
  if (Number.isInteger(base)) return Math.round(v)
  return Math.round(v * 100) / 100
}

/**
 * 숫자 설정 하나의 고를 것 셋.
 *
 * 겹치는 값은 버린다 — 같은 값 버튼이 둘이면 누르는 사람은 다른 일이 일어날 것으로 읽는다.
 * 기본값이 범위 끝에 붙어 있으면 둘만 남을 수도 있다. 그것이 사실이다.
 */
export function presetsFor(spec: TradingSetting): Preset[] {
  if (spec.type !== 'number') return []
  const base = typeof spec.defaultValue === 'number' ? spec.defaultValue : 0

  const raw: Preset[] = [
    { label: '적게', value: clamp(keepShape(base, base * LESS), spec), recommended: false },
    { label: '기본', value: clamp(base, spec), recommended: true },
    { label: '많게', value: clamp(keepShape(base, base * MORE), spec), recommended: false },
  ]

  /**
   * 기본값이 0 이면 배수가 전부 0 이다. 그때는 범위의 양 끝을 쓴다 —
   * 0 만 셋 놓아 두면 고를 것이 없는 것과 같다.
   */
  if (base === 0 && spec.max !== undefined) {
    raw[2] = { label: '많게', value: keepShape(base, spec.max), recommended: false }
  }

  /**
   * 겹치면 **권장을 남긴다.** 앞에서부터 지우면 기본값이 사라지는 날이 온다 —
   * 기본이 범위 끝에 붙은 설정(최솟값과 같은 값)이 그렇다.
   */
  const kept: Preset[] = []
  for (const p of [...raw].sort((a, b) => Number(b.recommended) - Number(a.recommended))) {
    if (!kept.some((k) => k.value === p.value)) kept.push(p)
  }
  return kept.sort((a, b) => a.value - b.value)
}

/** 슬라이더가 한 번에 움직이는 폭. 정수 설정은 1, 소수 설정은 100분의 1 */
export function stepFor(spec: TradingSetting): number {
  const base = typeof spec.defaultValue === 'number' ? spec.defaultValue : 0
  const span = (spec.max ?? 100) - (spec.min ?? 0)
  /**
   * 칸 수를 200 아래로 유지한다. 넘으면 손으로 못 맞춘다.
   *
   * 실측: 표본 수 설정이 1~1000 이라 999칸, 손절 배수가 0.1~10 을 0.01 로 나눠 990칸이었다.
   * 정수 설정은 한 칸이 정수여야 하고(봉 수가 3.5 면 못 쓴다), 소수 설정은 잘게 나눠도 된다.
   */
  const MAX_STEPS = 200
  if (Number.isInteger(base)) return Math.max(1, Math.ceil(span / MAX_STEPS))
  const fine = [0.01, 0.05, 0.1, 0.25, 0.5, 1]
  return fine.find((f) => span / f <= MAX_STEPS) ?? Math.ceil(span / MAX_STEPS)
}

/** 슬라이더를 그릴 수 있나. 양 끝을 모르면 못 그린다 */
export function canSlide(spec: TradingSetting): boolean {
  return spec.type === 'number' && spec.min !== undefined && spec.max !== undefined
}
