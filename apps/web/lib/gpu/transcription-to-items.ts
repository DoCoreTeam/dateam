// 전사 → 경쟁사 후보 변환 SSOT — 순수함수. 전사 rows를 "표시·저장용 경쟁사 아이템"으로 옮긴다.
// 왜: classify 단계는 specContext(카탈로그 표준 매핑)가 주입돼 원문 모델명을 우리 카탈로그명으로 둔갑시킨다
//   (HGX B300 → "H100 80GB", 가격없는 GB300/GB200 드롭, 모델당 2가격 2행). 경쟁사 시장데이터엔 치명적.
//   전사는 입력을 본 그대로 옮긴 결과 → 여기서 원문 모델명·전 행·가격미상을 보존해 경쟁사 후보로 만든다.
// 정책: 카탈로그 매핑 절대 금지. raw_label을 model_name으로 그대로 사용. 추측·보완 없음.

import type { TranscriptionRow } from './transcription.ts'
import type { CompetitorLike } from './dedup.ts'
import { resolveCurrency, toUsdPerGpuHour } from './normalize-money.ts'

// 변환 결과 — route가 emit하는 경쟁사 preview/저장 아이템과 동일 형태.
// CompetitorLike(+ source_model_name·price_unknown) — dedup·validate·프론트가 그대로 소비.
export interface CompetitorCandidate extends CompetitorLike {
  competitor_name: string
  /** 원문 모델명 그대로(예 "NVIDIA HGX B300") — 카탈로그 매핑 금지 */
  model_name: string
  /** 대표 가격(USD/GPU·hr). 가격 미상·KRW이나 환율 미주입이면 null */
  price_usd: number | null
  /** 가격 미상(Contact us/—/빈칸) — needs_review 플래그 */
  price_unknown: boolean
  /** 원문 보존(프론트 병기·reconcile 라벨 대조용) */
  source_model_name: string
  /** 원본 통화(ISO 코드 'KRW'|'USD' 등). 통화 미감지면 null(폴백=USD 가정) */
  original_currency: string | null
  /** 원본 통화 기준 대표 금액(GPU 1장·1시간당). 가격 미상이면 null */
  original_price: number | null
  /** 보조가(preemptible 등)·기타 메모 */
  notes?: string
}

export interface TranscriptionToItemsOptions {
  /** 경쟁사명(예 'Nebius'). 없으면 빈 문자열 — 호출부가 provider 추론해 주입 */
  provider?: string
  /** 1 USD = krwPerUsd KRW(fx_rates 최신 usd_krw). KRW 금액의 USD 환산에 필요. 미주입 시 KRW는 price_usd=null. */
  krwPerUsd?: number
}

// 가격 토큰 1개 → { amount, currency }. "$7.85"→{7.85,'USD'}, "₩2,400,000"→{2400000,'KRW'}, "1,234.5"→{1234.5,null}.
// 숫자가 없으면 null(= 가격 미상). 통화 감지는 resolveCurrency(SSOT). 천단위 콤마·"from"/"~"/공백 관용.
interface ParsedPrice { amount: number; currency: string | null }
function parsePriceToken(token: string): ParsedPrice | null {
  if (typeof token !== 'string') return null
  const t = token.trim()
  if (t.length === 0) return null
  // 가격 미상 키워드 — "Contact us", "문의", "—", "-", "N/A", "TBD" 등
  if (/contact|문의|inquir|tbd|n\/?a/i.test(t)) return null
  // 첫 번째 숫자(소수 포함, 천단위 콤마 허용) 추출
  const m = t.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0].replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  // 통화 감지(SSOT) — 토큰 전체에서 기호/약어 탐지. 미감지면 null(USD 가정 폴백).
  return { amount: n, currency: resolveCurrency(t) }
}

// 한 전사 행에서 가격 후보들({amount,currency}) 추출 — price_text 우선, 없으면 cells에서 가격형 토큰 스캔.
// 표에 가격열이 2개(preemptible/on-demand)면 cells에 두 가격이 들어온다.
function extractPriceCandidates(row: TranscriptionRow): ParsedPrice[] {
  const out: ParsedPrice[] = []
  const pushIf = (v: ParsedPrice | null) => { if (v !== null) out.push(v) }
  // price_text가 여러 가격을 담을 수 있음("$3.95 / $7.15") → 토큰 단위로 모두 시도
  if (typeof row.price_text === 'string' && row.price_text.trim().length > 0) {
    for (const tok of row.price_text.split(/[/|]|→|~|·|,(?=\s*(?:from\s*)?\$)/i)) pushIf(parsePriceToken(tok))
    if (out.length === 0) pushIf(parsePriceToken(row.price_text))
  }
  // cells에서 통화기호($/₩/원/USD 등)나 명백한 가격형 토큰만 — 메모리(80GB) 같은 비가격 숫자 혼입 방지
  if (Array.isArray(row.cells)) {
    for (const cell of row.cells) {
      if (typeof cell !== 'string') continue
      if (!/[$₩€£]|usd|krw|\/\s*(?:hr|hour|시간|gpu)/i.test(cell)) continue
      pushIf(parsePriceToken(cell))
    }
  }
  return out
}

// 전사 rows → 경쟁사 후보[]. 모델당 1행(중복 금지). 원문 모델명·가격미상 보존.
// 카탈로그 매핑 안 함(이것이 핵심 — model_name = raw_label 그대로).
export function transcriptionToCompetitorItems(
  rows: TranscriptionRow[],
  opts: TranscriptionToItemsOptions = {},
): CompetitorCandidate[] {
  if (!Array.isArray(rows)) return []
  const provider = typeof opts.provider === 'string' ? opts.provider.trim() : ''
  const krwPerUsd = typeof opts.krwPerUsd === 'number' && opts.krwPerUsd > 0 ? opts.krwPerUsd : null
  const out: CompetitorCandidate[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const label = typeof row.raw_label === 'string' ? row.raw_label.trim() : ''
    if (!label) continue // 모델 라벨 없는 행은 경쟁사 후보로 식별 불가 — 스킵

    const prices = extractPriceCandidates(row)
    // 시장비교 표준 = on-demand(보통 더 비싼/마지막 가격). 대표가 1개 선택.
    //   2가격(preemptible/on-demand)이면 더 큰 금액(on-demand)을 대표가로, 작은 값은 notes에.
    let rep: ParsedPrice | null = null
    let notes: string | undefined
    if (prices.length === 1) {
      rep = prices[0]
    } else if (prices.length >= 2) {
      rep = prices.reduce((a, b) => (b.amount > a.amount ? b : a)) // on-demand 대표(최대 금액)
      const minP = prices.reduce((a, b) => (b.amount < a.amount ? b : a))
      notes = `preemptible ${minP.amount}` // 보조가 보존(통화 무관, 원본 금액)
    }

    // 원본 통화·금액 보존 + USD 정규화(콕핏 비교용 SSOT). 환산은 normalize-money(toUsdPerGpuHour).
    //   경쟁사 가격 표준 = per-GPU·hr → period='hour', gpuCount=1.
    let priceUsd: number | null = null
    let originalCurrency: string | null = null
    let originalPrice: number | null = null
    if (rep) {
      originalPrice = rep.amount
      originalCurrency = rep.currency // 미감지면 null(폴백=USD 가정)
      if (rep.currency === 'USD' || rep.currency === null) {
        // USD 또는 통화 미감지(무기호 표) → 금액을 그대로 USD로. (기존 동작 유지 — 회귀 0)
        priceUsd = rep.amount
      } else if (rep.currency === 'KRW') {
        // KRW는 환율 필요 — 미주입이면 환산 불가(price_usd=null, price_unknown 처리). 원본은 보존.
        priceUsd = krwPerUsd
          ? toUsdPerGpuHour({ amount: rep.amount, currency: 'KRW', period: 'hour', gpuCount: 1, krwPerUsd })
          : null
      } else {
        // 감지된 비USD·비KRW 통화(JPY/EUR/CNY 등) → 환율 미지원.
        //   과거: amount를 그대로 USD로 대입해 ¥30,000이 $30,000으로 둔갑(150배 오류, 일본 사이트 사고).
        //   지금: USD 둔갑 절대 금지 → price_usd=null(보류·price_unknown). 원본 통화·금액은 보존해 검수로 넘김.
        //   정식 환산은 fx_rates 다통화 확장 후속(DECISION-20260716-currency-hold).
        priceUsd = null
      }
    }
    // 환산 결과가 NaN/음수면 미상 처리(방어).
    if (priceUsd != null && (!Number.isFinite(priceUsd) || priceUsd <= 0)) priceUsd = null
    const priceUnknown = priceUsd === null

    out.push({
      competitor_name: provider,
      model_name: label,        // 원문 그대로 — 카탈로그 매핑 금지
      price_usd: priceUsd,
      price_unknown: priceUnknown,
      source_model_name: label, // 원문 보존(프론트 병기·reconcile)
      original_currency: originalCurrency,
      original_price: originalPrice,
      ...(notes ? { notes } : {}),
    })
  }

  return out
}
