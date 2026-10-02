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

/**
 * 통화를 어떻게 붙이나.
 *
 * **왜 코드(KRW)를 안 쓰나**: 한국어 문서에서 「548,375,000 KRW」라고 쓰는 곳은 없다.
 * 견적서·세금계산서·거래명세서 전부 **「원」** 이거나 **「₩」** 다.
 * ISO 코드는 시스템끼리 주고받는 말이지 사람에게 보여 주는 말이 아니다.
 * (사용자 지적: 「KRW 이렇게 안써 원이나 원 표시를 쓴다구」)
 *
 * 원화·엔화는 **뒤에 붙는 접미사**(1,000원 · 1,000엔), 달러·유로는 **앞에 붙는 기호**($1,000).
 * 그 나라에서 실제로 쓰는 방식을 따른다 — 「1,000 USD」도 사람이 쓰는 말이 아니다.
 */
const CURRENCY_STYLE: Record<string, { suffix?: string; prefix?: string }> = {
  KRW: { suffix: '원' },
  JPY: { suffix: '엔' },
  USD: { prefix: '$' },
  EUR: { prefix: '€' },
  GBP: { prefix: '£' },
  CNY: { suffix: '위안' },
}

/** 금액 뒤(또는 앞)에 붙는 것. 모르는 통화는 코드를 그대로 뒤에 붙인다 */
export function currencyAffix(currency: string | null | undefined): { prefix: string; suffix: string } {
  const cur = (currency ?? 'KRW').trim().toUpperCase()
  const style = CURRENCY_STYLE[cur]
  if (!style) return { prefix: '', suffix: ` ${cur}` }
  return { prefix: style.prefix ?? '', suffix: style.suffix ?? '' }
}

/**
 * 사람이 적은 금액 → **저장값(minor)**. `formatAmount` 의 반대쪽이다.
 *
 * **왜 필요한가**: 금액 칸(`MoneyField`)은 사람이 친 숫자를 그대로 돌려준다.
 * 원화는 자리수가 0 이라 그 값이 곧 minor 여서 지금까지 문제가 없었는데,
 * **통화를 고를 수 있게 되는 순간** 같은 코드가 사고의 입구가 된다 —
 * USD 를 골라 `1080` 을 치면 1080 센트, 즉 **$10.80** 으로 저장된다.
 * (반대 방향 사고도 있었다: `crm/reports/TargetModal` 이 무턱대고 `00` 을 붙여
 *  10억을 1,000억으로 만든 것 — 자리수는 통화가 정해야 하고, 사람이 정하면 100배가 틀린다.)
 *
 * 소수는 **문자열로** 반올림한다(BigInt). 부동소수를 거치면 `1080.57` 이
 * `108056.99999` 가 되고 그 줄만 1원씩 어긋난다.
 */
export function toMinorAmount(
  major: string | null | undefined,
  currency: string | null | undefined,
): string {
  const raw = (major ?? '').trim()
  if (!raw) return ''
  const digits = minorDigits(currency)
  const [intRaw = '', fracRaw = ''] = raw.split('.')
  const int = intRaw.replace(/\D/g, '')
  const frac = fracRaw.replace(/\D/g, '')
  if (!int && !frac) return ''

  // 자리수보다 한 자리 더 떼어 둔다 — 그 한 자리가 반올림을 정한다
  const padded = `${frac}${'0'.repeat(digits + 1)}`.slice(0, digits + 1)
  const kept = `${int || '0'}${padded.slice(0, digits)}`.replace(/^0+(?=\d)/, '')
  const next = padded.slice(digits, digits + 1)
  const out = next && Number(next) >= 5 ? (BigInt(kept) + BigInt(1)).toString() : kept
  return out
}

/** 사람이 읽는 금액. 금액이 없으면 null — 호출부가 "미정"을 자기 말로 쓴다 */
export function formatAmount(
  minor: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (minor === null || minor === undefined || minor === '') return null
  const cur = (currency ?? 'KRW').trim().toUpperCase()
  const digits = minorDigits(cur)
  const { prefix, suffix } = currencyAffix(cur)
  const n = Number(minor) / 10 ** digits
  // 표현 가능 범위를 넘으면 반올림된 거짓 숫자 대신 원값을 그대로 보여 준다
  if (!Number.isFinite(n) || !Number.isSafeInteger(Number(minor))) return `${prefix}${minor}${suffix}`
  /*
    **소수 자리는 통화가 정한다 — 최소도 최대도.**

    최대만 주면 센트가 0 인 금액은 「$1,080」, 50센트는 「$1,080.5」로 뜬다.
    돈을 그렇게 적는 곳은 없다 — 달러는 늘 두 자리다(`quote-xlsx.ts` 는 이미 `#,##0.00` 을 쓴다).
    원·엔은 자리수가 0 이라 그대로다.
  */
  return `${prefix}${n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`
}
