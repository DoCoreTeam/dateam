// lib/gpu/price-signal.ts — 가격 시그널 SSOT
//
// marginSignal / deviationSignal 두 순수함수.
// 임계 상수를 export하여 UI가 범례/색상 결정 시 재사용한다.

/** 마진 시그널 레벨 */
export type MarginSignal = 'danger' | 'warn' | 'ok' | 'over'

/** 시장 편차 시그널 레벨 */
export type DeviationSignal = 'cheap' | 'ok' | 'expensive'

// ── 마진 임계 상수 ─────────────────────────────────────────────────────────────
export const MARGIN_DANGER_MAX = 10   // pct < 10 → danger
export const MARGIN_WARN_MAX   = 15   // 10 ≤ pct < 15 → warn
export const MARGIN_OK_MAX     = 25   // 15 ≤ pct ≤ 25 → ok  /  pct > 25 → over

// ── 편차 임계 상수 ─────────────────────────────────────────────────────────────
export const DEVIATION_CHEAP_MAX     = -10  // pct < -10 → cheap
export const DEVIATION_EXPENSIVE_MIN =  10  // pct > 10  → expensive

/**
 * 실효마진%에서 시그널을 반환한다.
 *
 * - pct < 10           → 'danger'
 * - 10 ≤ pct < 15      → 'warn'
 * - 15 ≤ pct ≤ 25      → 'ok'
 * - pct > 25           → 'over'
 */
export function marginSignal(pct: number): MarginSignal {
  if (pct < MARGIN_DANGER_MAX) return 'danger'
  if (pct < MARGIN_WARN_MAX)   return 'warn'
  if (pct <= MARGIN_OK_MAX)    return 'ok'
  return 'over'
}

/**
 * 시장 중앙값 대비 편차%에서 시그널을 반환한다.
 * 편차% = (우리가격 - 시장중앙) / 시장중앙 × 100
 *
 * - pct > 10   → 'expensive'  (우리가격이 시장보다 10% 초과 비쌈)
 * - -10 ≤ pct ≤ 10 → 'ok'
 * - pct < -10  → 'cheap'      (우리가격이 시장보다 10% 초과 저렴)
 */
export function deviationSignal(pct: number): DeviationSignal {
  if (pct > DEVIATION_EXPENSIVE_MIN) return 'expensive'
  if (pct < DEVIATION_CHEAP_MAX)     return 'cheap'
  return 'ok'
}
