// USAI Stage 4 보조 — 통화/단위 정규화 SSOT (선언적 lookup + 결정론 산술).
// 철학: AI는 raw 토큰만 뽑고, 환산은 100% 코드. 새 통화/단위는 코드 분기가 아니라 아래 테이블 1행 추가.
// 도메인 밴드(예: "T4는 얼마") 금지 — 여기는 형식불변 환산만.

export type Period = 'hour' | 'day' | 'month' | 'year'

// ── 선언적 lookup (확장 = 1행 추가) ──
// 키는 모두 소문자/공백제거 비교. 통화 기호·약어·다국어 동의어.
export const CURRENCY_TOKENS: Record<string, string> = {
  '₩': 'KRW', '원': 'KRW', krw: 'KRW', won: 'KRW',
  '$': 'USD', usd: 'USD', 'us$': 'USD', 달러: 'USD', dollar: 'USD',
  '€': 'EUR', eur: 'EUR', 유로: 'EUR',
  '¥': 'JPY', jpy: 'JPY', 엔: 'JPY', '円': 'JPY', '元': 'CNY', cny: 'CNY', rmb: 'CNY',
}

export const PERIOD_TOKENS: Record<string, Period> = {
  hour: 'hour', hourly: 'hour', hr: 'hour', '/hr': 'hour', '시간당': 'hour', '시간': 'hour', perhour: 'hour', '時間': 'hour',
  day: 'day', daily: 'day', '/day': 'day', '일': 'day', '일당': 'day', '日': 'day',
  month: 'month', monthly: 'month', mo: 'month', '/mo': 'month', '월': 'month', '월간': 'month', '月': 'month', '月額': 'month',
  year: 'year', yearly: 'year', annual: 'year', yr: 'year', '/yr': 'year', '년': 'year', '연간': 'year', '年': 'year',
}

// "월 720시간기준"(입력 파일 자체 규약) — 월을 시간으로 환산하는 표준 계수.
const HOURS_PER: Record<Period, number> = { hour: 1, day: 24, month: 720, year: 8760 }

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/** 토큰 → ISO 통화코드. 부분일치(기호 포함) 허용. 미지 → null(호출부가 needs_human 처리). */
export function resolveCurrency(token: string | null | undefined): string | null {
  if (!token) return null
  const k = norm(token)
  if (CURRENCY_TOKENS[k]) return CURRENCY_TOKENS[k]
  for (const [sym, code] of Object.entries(CURRENCY_TOKENS)) {
    if (k.includes(norm(sym))) return code
  }
  return null
}

/** 토큰 → 정규 기간. 미지 → null. */
export function resolvePeriod(token: string | null | undefined): Period | null {
  if (!token) return null
  const k = norm(token)
  if (PERIOD_TOKENS[k]) return PERIOD_TOKENS[k]
  for (const [t, p] of Object.entries(PERIOD_TOKENS)) {
    if (k.includes(norm(t))) return p
  }
  return null
}

/** 텍스트에서 GPU 장수 추론("x8"·"×8"(전각)·"8장"·"8枚"(일)·"서버1대(8장)" → 8 / "1장","x1" → 1). 미지 → null. */
export function resolveGpuCount(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.toLowerCase()
  // "x N" 또는 "× N"(전각). GPU[80GB] × 8 처럼 대괄호·공백 뒤에도 매칭.
  const x = t.match(/[x×]\s*(\d{1,2})(?!\d)/)
  if (x) return parseInt(x[1], 10)
  // "N장"(한) 또는 "N枚"(일 — GPU 카드 세는 단위 "1枚あたり").
  const jang = t.match(/(\d{1,2})\s*[장枚]/)
  if (jang) return parseInt(jang[1], 10)
  return null
}

export function periodToHours(p: Period): number {
  return HOURS_PER[p]
}

export interface MoneyNormalizeInput {
  amount: number
  currency: string // ISO code (resolveCurrency 결과)
  period: Period
  gpuCount: number
  /** 1 USD = krwPerUsd KRW. 비KRW는 별도 fx 필요(현재 KRW↔USD만). */
  krwPerUsd: number
}

/**
 * 임의 (금액·통화·기간·장수) → USD per 단일 GPU per hour 정규화.
 * 형식불변: 어떤 표든 동일 산술. 환율은 주입(org_content 매매기준율), 하드코딩 금지.
 */
export function toUsdPerGpuHour(input: MoneyNormalizeInput): number {
  const { amount, currency, period, gpuCount, krwPerUsd } = input
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount invalid')
  if (gpuCount <= 0) throw new Error('gpuCount invalid')
  if (krwPerUsd <= 0) throw new Error('krwPerUsd invalid')

  // 1) 통화 → USD
  let usd: number
  if (currency === 'USD') usd = amount
  else if (currency === 'KRW') usd = amount / krwPerUsd
  else throw new Error(`unsupported currency for fx: ${currency}`)

  // 2) 기간 → 시간당
  const perHour = usd / periodToHours(period)
  // 3) 장수 → 단일 GPU
  return perHour / gpuCount
}

/**
 * 이미 "GPU 1장·1시간당" 정규화된 원본 통화 금액 → USD (통화만 환산).
 * 정책(SSOT): AI가 환율을 스스로 계산하게 두지 않는다. USD=그대로, KRW=fx 환산,
 *   그 외(JPY/EUR/CNY/미감지)=null 보류(USD 둔갑 금지 — ¥30,000→$30,000 150배 사고 방지).
 * transcription-to-items의 통화 분기와 동일 정책을 경쟁사 AI 항목(market/refresh) 경로에도 재사용.
 */
export function competitorPriceToUsd(
  originalCurrency: string | null | undefined,
  originalPrice: number | null | undefined,
  krwPerUsd: number,
): number | null {
  if (typeof originalPrice !== 'number' || !Number.isFinite(originalPrice) || originalPrice <= 0) return null
  const cur = originalCurrency ?? 'USD' // 통화 미감지(무기호) → USD 가정(기존 동작 유지)
  if (cur === 'USD') return originalPrice
  if (cur === 'KRW') return krwPerUsd > 0 ? originalPrice / krwPerUsd : null
  return null // JPY/EUR/CNY 등 — 환율 미지원, USD 둔갑 금지 → 보류(검수)
}

// ── 다통화 환산 (확정 기획 P2·P3) — 원본에서 KRW로. 환율맵은 fx_rates_multi.krw_per_1(1통화당 KRW) ──

/** 통화 → KRW 환율맵. { JPY: 9.5, USD: 1342.5, ... } (1통화당 KRW, JPY 100단위는 이미 정규화된 값). */
export type FxKrwMap = Record<string, number>

// 통화 기호 중의성 — 국가 힌트로 확정. $=US/SG/HK/AU, ¥/￥=CN(위안)/JP(엔).
//   국가 힌트 없으면 기본값(¥→JPY, $→USD)으로 폴백(기존 동작 유지).
const AMBIGUOUS_BY_COUNTRY: Record<string, Record<string, string>> = {
  $:  { US: 'USD', SG: 'SGD', HK: 'HKD', AU: 'AUD', CA: 'CAD', NZ: 'NZD', TW: 'TWD' },
  '¥': { JP: 'JPY', CN: 'CNY' },
  '￥': { JP: 'JPY', CN: 'CNY' },
}

/**
 * 통화 확정 — 텍스트에서 통화를 뽑되, `$`/`¥` 같은 중의적 기호는 국가 힌트(ISO2, 예 'JP'·'CN'·'SG')로 확정.
 * 국가 힌트가 없거나 매핑에 없으면 resolveCurrency 기본값으로 폴백. (사이트 도메인/국가로 호출부가 힌트 주입)
 */
export function resolveCurrencyWithCountry(
  token: string | null | undefined,
  countryHint?: string | null,
): string | null {
  if (!token) return null
  const cc = (countryHint ?? '').toUpperCase()
  for (const [sym, byCountry] of Object.entries(AMBIGUOUS_BY_COUNTRY)) {
    if (token.includes(sym) && cc && byCountry[cc]) return byCountry[cc]
  }
  return resolveCurrency(token)
}

/**
 * 관측 원본 금액(통화 기준) → KRW. 환율맵(krw_per_1)에서 통화를 찾아 곱한다.
 * KRW=그대로, 맵에 없는 통화=null(보류 — 임의 USD 둔갑 금지). float 오류 방지 위해 호출부가 표시 직전 1회 반올림.
 */
export function amountToKrw(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fx: FxKrwMap,
): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  const cur = (currency ?? '').toUpperCase()
  if (cur === 'KRW') return amount
  const rate = fx[cur]
  if (typeof rate === 'number' && rate > 0) return amount * rate
  return null // 환율 미보유 통화 → 보류(검수). 감지 실패도 여기.
}

/** KRW → 임의 통화(표시 보조). 교차환율은 같은 맵(같은 날짜·소스)에서만. */
export function krwToCurrency(krw: number, currency: string, fx: FxKrwMap): number | null {
  const cur = currency.toUpperCase()
  if (cur === 'KRW') return krw
  const rate = fx[cur]
  return typeof rate === 'number' && rate > 0 ? krw / rate : null
}
