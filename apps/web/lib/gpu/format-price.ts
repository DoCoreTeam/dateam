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

export type CurrencyMode = 'KRW' | 'USD'

/**
 * KRW로 저장된 값을 통화 모드에 맞춰 표시. USD 모드면 환율로 역환산.
 * 화면 통화 일관성 SSOT — 같은 값을 화면마다 ₩/$ 다르게 찍지 않도록 여기로 통일.
 */
export function fmtMoneyFromKrw(krw: number | null | undefined, mode: CurrencyMode, usdKrw: number): string {
  if (krw == null || !isFinite(krw)) return '—'
  if (mode === 'USD') return fmtUSD(usdKrw > 0 ? krw / usdKrw : null)
  return fmtKRW(krw)
}

/**
 * USD로 저장된 값(견적 단가 등)을 통화 모드에 맞춰 표시. KRW 모드면 환율로 환산.
 */
export function fmtMoneyFromUsd(usd: number | null | undefined, mode: CurrencyMode, usdKrw: number): string {
  if (usd == null || !isFinite(usd)) return '—'
  if (mode === 'KRW') return fmtKRW(usd * usdKrw)
  return fmtUSD(usd)
}
