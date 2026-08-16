// 금액 표시 SSOT (dacrm T1-03)
//
// 보드 카드와 표가 같은 금액을 다르게 그리면 사용자는 둘 중 무엇이 맞는지 알 수 없다.
// 표시 변환은 한 곳에 두고 두 뷰가 함께 import 한다(§2 "표시 로직도 SSOT").
//
// 금액은 minor 정수 문자열로 온다 — JSON 은 BigInt 를 못 싣고,
// number 로 받으면 2^53 을 넘는 금액에서 조용히 값이 틀어진다.

/** 소수 자리가 없는 통화 — minor 가 곧 표시 단위다 */
const ZERO_DECIMAL = new Set(['KRW', 'JPY'])

export function minorDigits(currency: string | null | undefined): number {
  const cur = (currency ?? 'KRW').trim().toUpperCase()
  return ZERO_DECIMAL.has(cur) ? 0 : 2
}

/** 사람이 읽는 금액. 금액이 없으면 null — 호출부가 "미정"을 자기 말로 쓴다 */
export function formatAmount(
  minor: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (minor === null || minor === undefined || minor === '') return null
  const cur = (currency ?? 'KRW').trim().toUpperCase()
  const digits = minorDigits(cur)
  const n = Number(minor) / 10 ** digits
  // 표현 가능 범위를 넘으면 반올림된 거짓 숫자 대신 원값을 그대로 보여 준다
  if (!Number.isFinite(n) || !Number.isSafeInteger(Number(minor))) return `${minor} ${cur}`
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: digits })} ${cur}`
}
