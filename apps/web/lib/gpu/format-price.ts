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
 * USD 포맷. 소수 최대 3자리·올림(ceil) + 천단위 구분. 최소 2자리(센트) 유지.
 * null/NaN → '—'
 *
 * 왜 ceil 3자리: KRW÷FX·÷시간 환산이 0.81018518… 같은 무한소수를 만들어
 *   raw로 노출되던 사고(사용자 원성)를 SSOT에서 차단. 셋째 자리에서 올림.
 *
 * @example fmtUSD(0.81018518) → '$0.811'   (셋째 자리 올림)
 * @example fmtUSD(1234.5) → '$1,234.50'
 * @example fmtUSD(3.24) → '$3.24'
 */
const USD_DECIMALS = 3
const USD_CEIL_FACTOR = 10 ** USD_DECIMALS // 1000

/** 셋째 자리 올림(부호 보존). 음수는 절대값 기준 올림 후 부호 복원(표시 일관). */
function ceilUsd(v: number): number {
  const sign = v < 0 ? -1 : 1
  return (sign * Math.ceil(Math.abs(v) * USD_CEIL_FACTOR)) / USD_CEIL_FACTOR
}

export function fmtUSD(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + ceilUsd(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: USD_DECIMALS })
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

/**
 * 행별 "원본 통화 기준" 표시 SSOT — 입력받은 그대로가 진실.
 *   뷰 통화(mode)와 행의 원본 통화가 같으면 원본 금액을 그대로, 다르면 fx로 환산해 보여준다.
 *   (원으로 들어온 행은 원 보기에선 원 그대로, 달러 보기에선 환산 / 달러 행은 그 반대)
 *   originalCurrency가 없으면(기존행) USD 가정. originalPrice 없으면 priceUsd로 폴백.
 */
export function fmtMoneyFromOriginal(
  originalCurrency: string | null | undefined,
  originalPrice: number | null | undefined,
  priceUsd: number | null | undefined,
  mode: CurrencyMode,
  usdKrw: number,
): string {
  if (originalCurrency === 'KRW') {
    // 원본 KRW 금액 우선. 없으면 priceUsd를 KRW로 되돌려 사용.
    const krw = typeof originalPrice === 'number' ? originalPrice
      : (typeof priceUsd === 'number' && usdKrw > 0 ? priceUsd * usdKrw : null)
    return fmtMoneyFromKrw(krw, mode, usdKrw)
  }
  // USD 또는 미상(USD 가정): 원본 USD 금액 우선, 없으면 priceUsd.
  const usd = typeof originalPrice === 'number' && originalCurrency === 'USD' ? originalPrice : priceUsd
  return fmtMoneyFromUsd(usd, mode, usdKrw)
}
