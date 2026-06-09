// lib/gpu/format-price.ts — 가격 포맷 SSOT
//
// fmtKRW / fmtUSD 단일 구현.
// PriceTableTab / MarketTab / catalog 등 중복 인라인 함수를 여기서 import해 사용한다.

/**
 * KRW 포맷. 소수 없이 반올림 + 천단위 구분.
 * null/NaN → '—'
 *
 * @example fmtKRW(1234567.8) → '₩1,234,568'
 */
export function fmtKRW(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '₩' + Math.round(v).toLocaleString('ko-KR')
}

/**
 * USD 포맷. 소수 2자리 고정 + 천단위 구분.
 * null/NaN → '—'
 *
 * @example fmtUSD(1234.5) → '$1,234.50'
 */
export function fmtUSD(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
