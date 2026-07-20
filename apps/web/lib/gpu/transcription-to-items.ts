// 전사 → 경쟁사 후보 변환 SSOT — 순수함수. 전사 rows를 "표시·저장용 경쟁사 아이템"으로 옮긴다.
// 왜: classify 단계는 specContext(카탈로그 표준 매핑)가 주입돼 원문 모델명을 우리 카탈로그명으로 둔갑시킨다
//   (HGX B300 → "H100 80GB", 가격없는 GB300/GB200 드롭, 모델당 2가격 2행). 경쟁사 시장데이터엔 치명적.
//   전사는 입력을 본 그대로 옮긴 결과 → 여기서 원문 모델명·전 행·가격미상을 보존해 경쟁사 후보로 만든다.
// 정책: 카탈로그 매핑 절대 금지. raw_label을 model_name으로 그대로 사용. 추측·보완 없음.

import type { TranscriptionRow } from './transcription.ts'
import type { CompetitorLike } from './dedup.ts'
import { resolveCurrency, resolvePeriod, resolveGpuCount, toUsdPerGpuHour, type FxKrwMap } from './normalize-money.ts'
import { classifyObservation } from './observation-classify.ts'
import { looksLikeGpuModel } from './validate.ts'
import { parseHourlyProse } from './deterministic-table.ts'
import { componentToKrwPerGpuHour, type PriceComponent } from './price-components.ts'
import { canonicalizeModel } from './canonical-model.ts'

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
  /**
   * 요금성분 N개(v0.7.351 재설계 T1.3) — 복합요금(기본료+종량+스토리지)의 무손실 진실.
   * 라벨산문(parseHourlyProse)에서 회수된 성분을 "이미 GPU로 식별된" 이 후보에 부착한다(라벨 승격 아님).
   * 있으면 market_price_components(마이그165)에 저장. 없으면 기존 obs_* 경로 그대로(하위호환).
   */
  components?: PriceComponent[]
  /** 관측 원본 성격(확정 기획 P5) — 세그먼트·번들·세금·기간·장수. 저장 시 market_prices obs_*로 persist. */
  obs?: {
    amount: number | null
    currency: string | null
    pricing_unit: string | null    // resolvePeriod 결과(hour/month…)
    gpu_count: number | null
    segment: 'raw_gpu' | 'managed_bundle'
    bundle_inclusive: boolean
    tax_basis: 'tax_excluded' | 'tax_included' | 'unknown'
    comparable: boolean
    provenance: string             // 원문 근거(라벨+셀)
  }
}

export interface TranscriptionToItemsOptions {
  /** 경쟁사명(예 'Nebius'). 없으면 빈 문자열 — 호출부가 provider 추론해 주입 */
  provider?: string
  /** 1 USD = krwPerUsd KRW(fx_rates 최신 usd_krw). KRW 금액의 USD 환산에 필요. 미주입 시 KRW는 price_usd=null. */
  krwPerUsd?: number
  /**
   * 통화→KRW 환율맵(fx_rates_multi, 예 { JPY: 9.5, USD: 1400 }). 라벨산문 요금성분 회수(T1.3)에서
   * usage 성분을 대표가로 환산할 때 필요(JPY 등 krwPerUsd 단일값으로 못 다루는 통화). 없으면 회수된
   * 성분은 부착되지만 대표가(price_usd)는 갱신되지 않음(price_unknown 유지 — 보류).
   */
  fxMap?: FxKrwMap
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
  const fxMap = opts.fxMap
  const out: CompetitorCandidate[] = []
  // 라벨산문 요금성분 회수(T1.3) — 직전에 GPU 모델로 식별된 후보(같은 표/블록의 앞선 행). 기본료·종량·
  //   스토리지처럼 자기 라벨은 GPU가 아닌(비GPU 라벨) 행이 나오면 이 후보에 성분으로 흡수한다.
  let currentModelCandidate: CompetitorCandidate | null = null

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const label = typeof row.raw_label === 'string' ? row.raw_label.trim() : ''
    if (!label) continue // 모델 라벨 없는 행은 경쟁사 후보로 식별 불가 — 스킵

    // 비GPU 라벨 행(月額基本料金·GPU利用料金·스토리지 등) — 라벨 자체를 모델로 승격하지 않는다(게이트 유지).
    //   직전 식별된 GPU 모델이 있으면 이 행의 금액을 그 모델의 요금성분으로 흡수(무손실 회수).
    //   parseHourlyProse는 결정론 정규식만 사용(SSOT 재사용) — model을 강제 주입해 자동감지를 건너뛴다.
    if (!looksLikeGpuModel(label) && currentModelCandidate) {
      const rowCtx = [label, row.price_text ?? '', ...(Array.isArray(row.cells) ? row.cells : [])].filter(Boolean).join(' ')
      const recovered = parseHourlyProse(rowCtx, currentModelCandidate.source_model_name)
      if (recovered && recovered.components.length > 0) {
        currentModelCandidate.components = [...(currentModelCandidate.components ?? []), ...recovered.components]
        // 대표가 갱신 — usage(GPU 종량) 성분이 있으면 그것으로 price_usd 재계산(base_fee/storage는 시간축 아님 → 제외).
        const usageComp = recovered.components.find((c) => c.component_kind === 'usage')
        if (usageComp && fxMap) {
          const krwPerGpuHour = componentToKrwPerGpuHour(usageComp, fxMap)
          const usdPerGpuHour = krwPerGpuHour != null && krwPerUsd ? krwPerGpuHour / krwPerUsd : null
          if (usdPerGpuHour != null && Number.isFinite(usdPerGpuHour) && usdPerGpuHour > 0) {
            currentModelCandidate.price_usd = usdPerGpuHour
            currentModelCandidate.price_unknown = false
            currentModelCandidate.original_currency = usageComp.currency
            currentModelCandidate.original_price = usageComp.amount
            if (currentModelCandidate.obs) {
              currentModelCandidate.obs.amount = usageComp.amount
              currentModelCandidate.obs.currency = usageComp.currency
              currentModelCandidate.obs.pricing_unit = usageComp.unit
              currentModelCandidate.obs.gpu_count = usageComp.gpu_count ?? 1
              currentModelCandidate.obs.comparable = true
            }
          }
        }
        continue // 이 행 자체는 별도 후보로 만들지 않음(성분으로 흡수 완료 — 기존 드롭 자리 대체)
      }
    }

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

    // 관측 성격 판정(P5) — 라벨+셀+가격문구 전체를 근거로 세그먼트·번들·세금·기간·장수 결정론 판정.
    //   콕핏 밴드는 raw_gpu·comparable만 쓰므로(P4 필터), 소프트뱅크 DGX 번들행은 여기서 managed_bundle로 격리된다.
    const ctx = [label, ...(Array.isArray(row.cells) ? row.cells : []), row.price_text ?? ''].filter(Boolean).join(' ')
    const cls = classifyObservation(ctx)
    const obs: CompetitorCandidate['obs'] = {
      amount: originalPrice,
      currency: originalCurrency,
      pricing_unit: resolvePeriod(ctx),      // 미감지면 null(호출부가 hour 가정 가능)
      gpu_count: resolveGpuCount(ctx),       // "8장"·"x8" 등, 미감지 null
      segment: cls.segment,
      bundle_inclusive: cls.bundle_inclusive,
      tax_basis: cls.tax_basis,
      comparable: cls.comparable,
      provenance: ctx.slice(0, 200),
    }

    const candidate: CompetitorCandidate = {
      competitor_name: provider,
      // 잡음 제거만(캐노니컬 SSOT) — 벤더·수량접두·메모리 토큰 제거. **카탈로그 매핑은 아니다**(그건 resolveProductId).
      //   실사고: verda 요금표 "1x GB300 SXM6 288GB"가 원문 그대로 나와 화면·매칭 양쪽에서 틀림.
      //   피벗·산문 경로는 이미 캐노니컬을 쓰는데 이 정상 경로만 원문이라 같은 화면에서 표기가 갈렸다.
      model_name: canonicalizeModel(label).canonical || label,
      price_usd: priceUsd,
      price_unknown: priceUnknown,
      source_model_name: label, // 원문 보존(프론트 병기·reconcile)
      original_currency: originalCurrency,
      original_price: originalPrice,
      obs,
      ...(notes ? { notes } : {}),
    }
    out.push(candidate)
    // 다음 비GPU 라벨 행(기본료·종량·스토리지 등)이 성분으로 흡수될 대상 갱신 — GPU로 식별된 행만.
    if (looksLikeGpuModel(label)) currentModelCandidate = candidate
  }

  return out
}

/**
 * 산문(비표) 복합요금 → 경쟁사 후보 1건 (v0.7.351 T1.3 실경로 결선).
 *
 * 왜 별도 경로인가: `transcriptionToCompetitorItems`의 성분 흡수는 "직전 행이 GPU 모델"이라는
 * **행 구조**를 전제한다. 그런데 소프트뱅크 시간제 요금처럼 원본이 한 덩어리 산문이면 전사가 행으로
 * 쪼개지 못해 그 전제가 성립하지 않고, 성분이 통째로 유실된다(실화면 검증에서 확인 — 3성분 0건 회수).
 * → 행 구조에 의존하지 않고 **원문 전체**에 결정론 파서를 1회 적용해 회수한다.
 *
 * 대표가(price_usd)는 usage(GPU 종량) 성분에서만 산출한다. 기본료·스토리지는 시간축이 아니라
 * 1장·1시간 단가로 환산할 수 없으므로 성분으로만 보존하고 대표가에 섞지 않는다(무손실 ≠ 임의합산).
 * 환율 미보유면 성분은 붙이되 가격은 보류(price_unknown) — AI 추정가 유입 금지 정책 유지.
 */
export function proseToCompetitorItems(
  rawText: string,
  opts: { provider: string; krwPerUsd?: number | null; fxMap?: FxKrwMap },
): CompetitorCandidate[] {
  if (!rawText || !rawText.trim()) return []
  const det = parseHourlyProse(rawText)
  if (!det || det.components.length === 0) return []

  const krwPerUsd = typeof opts.krwPerUsd === 'number' && opts.krwPerUsd > 0 ? opts.krwPerUsd : null
  const usage = det.components.find((c) => c.component_kind === 'usage')

  let priceUsd: number | null = null
  if (usage && opts.fxMap && krwPerUsd) {
    const krwPerGpuHour = componentToKrwPerGpuHour(usage, opts.fxMap)
    if (krwPerGpuHour != null && Number.isFinite(krwPerGpuHour) && krwPerGpuHour > 0) {
      priceUsd = krwPerGpuHour / krwPerUsd
    }
  }

  const cls = classifyObservation(`${det.provenance} ${det.model_name} ${rawText.slice(0, 400)}`)
  return [{
    competitor_name: opts.provider,
    model_name: det.model_name,
    source_model_name: det.source_model_name,
    price_usd: priceUsd,
    price_unknown: priceUsd == null,
    original_currency: usage?.currency ?? det.components[0]?.currency ?? null,
    original_price: usage?.amount ?? null,
    components: det.components,
    obs: {
      amount: usage?.amount ?? null,
      currency: usage?.currency ?? null,
      pricing_unit: usage?.unit ?? null,
      gpu_count: usage?.gpu_count ?? 1,
      segment: det.segment,
      bundle_inclusive: cls.bundle_inclusive,
      tax_basis: cls.tax_basis,
      comparable: true,
      provenance: det.components.map((c) => c.provenance).filter(Boolean).join(' | ').slice(0, 500),
    },
  }]
}
