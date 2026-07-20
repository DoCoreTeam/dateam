// AI 구조화 관측 추출 파이프라인 SSOT (P4 통합, v0.7.372) — review/stream과 market/refresh가 동일 처리를 공유한다.
//   왜: market/refresh(관리자 페이지 진입 시 하루 1회 자동 수집 — 실질 주 데이터 유입 경로)가 review/stream(사용자
//   수동 입력)과 서로 다른 추출 로직을 썼다. 같은 데이터가 어느 문으로 들어오냐에 따라 다르게 처리되는 것 자체가
//   버그 공급원 → review/stream의 "AI 구조화 관측(v0.7.357)" 블록을 그대로 이 함수로 옮기고 양쪽이 호출한다.
//   정책 변경 없음(순수 리팩터) — 새 산술·새 정규식을 만들지 않는다. 기존 SSOT만 재사용:
//   ai-observation(추출)·observation-contract(검증+산술)·completeness-reconcile(완전성 게이트)·
//   canonical-model+form-factor(모델명 표기 통일)·validate(GPU 모델 게이트)·provider-registry(경쟁사명 폴백).

import { extractAiObservations, type GeminiCaller } from './ai-observation.ts'
import { usdPerGpuHourDirect, observationToKrwPerGpuHour, type AiObservation } from './observation-contract.ts'
import { reconcile as reconcileCompleteness, type ReconcileResult } from './completeness-reconcile.ts'
import { canonicalizeModel } from './canonical-model.ts'
import { extractFormFactor } from './form-factor.ts'
import { looksLikeGpuModel } from './validate.ts'
import { providerFromUrl } from './provider-registry.ts'
import type { FxKrwMap } from './normalize-money.ts'

// 추출 결과 1건 — CompetitorPriceItem(competitor-import.ts)의 상위집합. saveCompetitorPrices가 그대로 소비 가능.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtractPipelineItem = Record<string, any>

export interface ExtractCompetitorObservationsParams {
  apiKey: string
  model: string
  /** 관측 대상 원문(URL 본문 병합 결과 등). */
  sourceText: string
  specContext: string
  /** 카탈로그 실재 검증용 — 없으면 검증 스킵(전부 통과). */
  catalogNames?: string[]
  /** 전사/화이트리스트 등에서 추론된 경쟁사명. AI가 못 채우면 폴백. */
  provider?: string | null
  /** 경쟁사명 최종 폴백(도메인 유래). */
  sourceUrl?: string | null
  krwPerUsd: number
  fxMap: FxKrwMap
  fxDate: string | null
  /**
   * 결정론 파서(전사 등)가 이미 만든 경쟁사 후보. 있으면:
   *  - AI 결과가 있으면 금액 기준 합집합 보완(AI 우선, 중복 제외 + GPU 모델 게이트).
   *  - AI 결과가 없고 이 목록에 GPU 모델로 판정되는 항목이 있으면 그대로 사용(회귀 0).
   *  - AI 결과도 없고 GPU 모델 판정도 없으면 items=[]를 반환 — 호출부가 자체 폴백(피벗 재구성 등)을 이어간다.
   */
  deterministicItems?: ExtractPipelineItem[]
  /** 테스트 주입용. 미주입 시 extractAiObservations의 운영 기본 경로(extract-helpers.callGeminiOnce) 사용. */
  geminiCaller?: GeminiCaller
}

export interface ExtractCompetitorObservationsResult {
  items: ExtractPipelineItem[]
  aiRejected: Array<{ reason: string; detail: string }>
  completeness: ReconcileResult
  /** AI↔결정론 모델 판정 불일치 메시지(보류 처리된 항목의 근거). 없으면 []. */
  crosscheckConflicts: string[]
  /** 합집합 보완으로 추가된 결정론 항목 수. */
  detSupplemented: number
  /** AI가 만든 1차 관측 항목 수(합집합 이전) — 호출부 진행 메시지 재현용. */
  aiItemsCount: number
}

const isSideComponent = (o: AiObservation) => o.component_kind === 'base_fee' || o.component_kind === 'storage'

function amtKey(it: ExtractPipelineItem): string | null {
  const o = it.obs as { amount?: unknown } | undefined
  const a = typeof o?.amount === 'number' ? o.amount
    : typeof it.original_price === 'number' ? it.original_price
    : typeof it.price_usd === 'number' ? it.price_usd : null
  return a === null ? null : `${a.toFixed(4)}|${String(it.pricing_model ?? 'on_demand')}`
}

function collectAmounts(items: ExtractPipelineItem[]): number[] {
  const out: number[] = []
  for (const it of items) {
    const o = it.obs as { amount?: unknown } | undefined
    if (typeof o?.amount === 'number' && o.amount > 0) out.push(o.amount)
    const op = it.original_price
    if (typeof op === 'number' && op > 0) out.push(op)
    const comps = it.components as Array<{ amount?: unknown }> | undefined
    for (const c of comps ?? []) if (typeof c?.amount === 'number' && c.amount > 0) out.push(c.amount)
  }
  return out
}

/**
 * AI 구조화 관측 추출 → 검증 → 축 조립 → (선택)결정론 합집합 보완 → 완전성 게이트.
 * review/stream route의 "AI 구조화 관측(v0.7.357)" 인라인 블록을 그대로 옮긴 순수 함수(부작용 없음, DB 미접근).
 */
export async function extractCompetitorObservations(
  params: ExtractCompetitorObservationsParams,
): Promise<ExtractCompetitorObservationsResult> {
  const {
    apiKey, model, sourceText, specContext, catalogNames,
    provider, sourceUrl, krwPerUsd, fxMap, fxDate, deterministicItems, geminiCaller,
  } = params

  // 카탈로그 정식명 해석기 — 우리가 조립한 이름("B200 SXM")을 카탈로그 실제 이름("B200 SXM6")으로 바꾼다.
  //   실사고 v0.7.365: 화면에 보이는 이름이 저장될 카탈로그 이름과 달라 정합성이 깨져 보였다.
  //   (core, formFactor) 2축으로 대조 — 폼팩터 세대(SXM4/5/6)는 흡수해 비교하되 표시는 카탈로그 표기를 따른다.
  //   매칭 실패 시엔 우리 조립명을 그대로 쓴다(신규 모델 후보 — 억지로 비슷한 이름을 붙이지 않는다).
  const catalogIndex = (catalogNames ?? []).map((n) => {
    const { core, formFactor } = extractFormFactor(n)
    return { name: n, key: `${core.toLowerCase().replace(/[\s\-_]+/g, '')}|${formFactor ?? ''}` }
  })
  const toCatalogName = (assembled: string): string => {
    if (catalogIndex.length === 0) return assembled
    const { core, formFactor } = extractFormFactor(assembled)
    const ck = core.toLowerCase().replace(/[\s\-_]+/g, '')
    return catalogIndex.find((c) => c.key === `${ck}|${formFactor ?? ''}`)?.name
      ?? catalogIndex.find((c) => c.key === `${ck}|`)?.name
      ?? assembled
  }

  let aiRes: { valid: AiObservation[]; rejected: Array<{ reason: string; detail: string }> } | null = null
  let aiItems: ExtractPipelineItem[] = []
  let aiRejected: Array<{ reason: string; detail: string }> = []

  try {
    aiRes = await extractAiObservations({ apiKey, model, sourceText, specContext, catalogNames, geminiCaller })
    aiRejected = aiRes.rejected
    // GPU 시간축이 아닌 성분(base_fee·storage)은 독립 항목으로 만들지 않고,
    //   같은 모델의 대표 관측에 components로 붙인다(무손실 보존 + 시세 왜곡 차단).
    const primaries = aiRes.valid.filter((o) => !isSideComponent(o))
    const sides = aiRes.valid.filter(isSideComponent)
    const sidesByModel = new Map<string, AiObservation[]>()
    for (const sc of sides) {
      const k = sc.model.toLowerCase()
      if (!sidesByModel.has(k)) sidesByModel.set(k, [])
      sidesByModel.get(k)!.push(sc)
    }
    // 대표 관측이 하나도 없으면(기본료만 있는 페이지) 성분을 잃지 않도록 그대로 노출.
    const aiSource = primaries.length > 0 ? primaries : aiRes.valid
    aiItems = aiSource.map((o: AiObservation) => {
      // 원본이 USD면 **KRW 왕복 없이 직접 산출** — 왕복하면 fxMap.USD와 krwPerUsd의 미세 차이가
      //   금액에 그대로 붙는다(실사고 v0.7.365: 원문 $3.02가 화면에 $3.021로, $1.40이 $1.401로 표시).
      //   USD 원본은 환산이 애초에 필요 없다 — 시간·장수·분모만 나누면 끝이다.
      const usd = o.currency === 'USD'
        ? usdPerGpuHourDirect(o)
        : (() => { const krw = observationToKrwPerGpuHour(o, fxMap); return krw != null && krwPerUsd > 0 ? krw / krwPerUsd : null })()
      return {
        competitor_name: o.competitor_name || provider || providerFromUrl(sourceUrl),
        // 모델명은 AI가 인식한 축을 코드가 조립한다 — catalog_match(AI의 매칭 의견)로 이름을 정하지 않는다.
        //   매칭은 저장 단계의 resolveProductId(결정론)가 하고, 실패하면 기존 정책대로 보류된다.
        //   폼팩터는 카탈로그가 구분하는 축이므로 이름에 붙인다("H100"+"SXM" → "H100 SXM").
        model_name: toCatalogName([canonicalizeModel(o.model).canonical || o.model, o.form_factor].filter(Boolean).join(' ')),
        source_model_name: o.model,
        ...(o.memory_gb ? { memory: `${o.memory_gb}GB` } : {}),
        price_usd: usd,
        price_unknown: usd == null,
        original_currency: o.currency,
        original_price: o.amount,
        // 요금 등급은 AI가 인식한 축을 그대로 — spot을 on_demand와 섞으면 시세 밴드가 왜곡된다.
        pricing_model: o.price_tier,
        // 같은 모델의 기본료·스토리지를 성분으로 첨부(market_price_components 저장 경로로 이어짐)
        ...(primaries.length > 0 && (sidesByModel.get(o.model.toLowerCase())?.length ?? 0) > 0
          ? { components: (sidesByModel.get(o.model.toLowerCase()) ?? []).map((sc) => ({
              component_kind: sc.component_kind, amount: sc.amount / sc.per_qty,
              currency: sc.currency, unit: sc.unit, gpu_count: sc.gpu_count, provenance: sc.provenance,
            })) }
          : {}),
        obs: {
          amount: o.amount, currency: o.currency, pricing_unit: o.unit, gpu_count: o.gpu_count,
          segment: null, bundle_inclusive: false, tax_basis: 'unknown', comparable: true,
          fx_source: 'koreaexim', fx_rate_date: fxDate,
          fx_rate: o.currency && o.currency !== 'KRW' ? fxMap[o.currency] ?? null : 1,
          provenance: o.provenance,
          // 인식한 스펙 축을 그대로 보존(마이그168) — 매칭에만 쓰고 버리지 않는다.
          //   신규 모델 등록 제안·변형(96GB vs 48GB) 판별의 근거가 된다.
          form_factor: o.form_factor,
          memory_gb: o.memory_gb,
          source_model: o.model,
        },
      }
    })
  } catch (e) {
    aiRejected = [{ reason: 'invalid_type', detail: `AI 구조화 관측 실패: ${e instanceof Error ? e.message : 'unknown'}` }]
  }

  const aiItemsCount = aiItems.length
  let items: ExtractPipelineItem[] = aiItems
  let detSupplemented = 0
  const crosscheckConflicts: string[] = []

  if (deterministicItems && deterministicItems.length > 0) {
    if (aiItems.length > 0) {
      // ── 이중 추출 합집합 ── AI 1순위 + 결정론이 놓친 행을 보완.
      //   중복 판정은 금액으로 한다(모델명 표기가 갈리면 다른 키가 돼 같은 행이 두 번 들어간다).
      //   보완 대상은 GPU 모델로 판정되고 가격이 있는 행만.
      const seen = new Set(aiItems.map(amtKey).filter((k): k is string => k !== null))
      const detOnly = deterministicItems.filter((it) => {
        const k = amtKey(it)
        if (k === null || seen.has(k)) return false
        if (typeof it.price_usd !== 'number' || it.price_usd <= 0) return false
        return looksLikeGpuModel(String(it.model_name ?? ''))
      })
      // 결정론 보완분도 같은 표기 규칙을 거친다 — 안 하면 화면에서 표기가 갈린다.
      const normalizedDet = detOnly.map((it) => {
        const raw = String(it.model_name ?? '')
        const { core, formFactor } = extractFormFactor(canonicalizeModel(raw).canonical || raw)
        return {
          ...it,
          //   보완분도 카탈로그 정식명으로 — 안 하면 "B300 SXM"(우리 조립)과 "B300"(카탈로그)이 섞여 보인다.
          model_name: toCatalogName([core, formFactor].filter(Boolean).join(' ')),
          source_model_name: it.source_model_name ?? raw,
          pricing_model: it.pricing_model ?? 'on_demand',
        }
      })
      items = [...aiItems, ...normalizedDet]
      detSupplemented = normalizedDet.length

      // ── 교차검증(P3) — AI 관측 ↔ 결정론 추출 대조(금액 기준) ──
      //   AI는 비결정성이 있다. 결정론 파서는 표기 변형에 약하지만 같은 입력에 항상 같은 답을 낸다.
      //   둘을 대조해 모델명이 어긋나면 조용히 한쪽을 고르지 않고 보류로 올린다.
      for (const it of items) {
        const amt = (it.obs as { amount?: unknown } | undefined)?.amount
        if (typeof amt !== 'number') continue
        //   ★ 참조는 **GPU 모델로 판정된 결정론 항목만** — 결정론 경로는 "GPU利用料金（1枚あたり）" 같은
        //     비GPU 라벨 행도 뱉는다. 이를 참조로 쓰면 금액만 같아도 "모델 불일치"로 오판해 정상 가격을 지운다.
        //     (실사고 v0.7.364: A100 시간제 $2.658이 7.2엔 매칭으로 보류 처리되며 유실됐다.)
        const det = deterministicItems.find((d) => {
          if (!looksLikeGpuModel(String(d.model_name ?? ''))) return false
          const dAmt = (d.obs as { amount?: unknown } | undefined)?.amount
          const cand = typeof dAmt === 'number' ? dAmt : (typeof d.original_price === 'number' ? d.original_price : null)
          return typeof cand === 'number' && Math.abs(cand - amt) < 1e-6
        })
        if (!det) continue
        //   ★ 비교는 **폼팩터를 뺀 core**로 한다 — AI는 폼팩터를 별도 축으로 분리해 "GB300"을 주고,
        //     결정론은 "GB300 SXM6"를 준다. 문자열 그대로 비교하면 같은 모델이 불일치로 잡혀
        //     정상 가격이 대량 유실된다(실사고 v0.7.364: verda 16건 null).
        const coreKey = (raw: string): string =>
          extractFormFactor(canonicalizeModel(raw).canonical || raw).core.toLowerCase().replace(/[\s\-_]+/g, '')
        const aiKey = coreKey(String(it.source_model_name ?? it.model_name ?? ''))
        const detKey = coreKey(String(det.model_name ?? ''))
        if (aiKey && detKey && aiKey !== detKey) {
          crosscheckConflicts.push(`${amt.toLocaleString()}: AI "${it.source_model_name ?? it.model_name}" ↔ 결정론 "${det.model_name}"`)
          it.price_unknown = true
          it.price_usd = null
        }
      }
    } else {
      const gpuValid = deterministicItems.filter((it) => looksLikeGpuModel(String(it.model_name ?? '')))
      // AI가 아무것도 못 뽑았을 때: 결정론이 GPU 모델을 갖고 있으면 그대로 채택(회귀 0).
      //   결정론도 GPU 모델이 하나도 없으면 items=[]로 반환 — 호출부가 자체 폴백(피벗 재구성 등)을 이어간다.
      items = gpuValid.length > 0 ? deterministicItems : []
    }
  }

  const rawAiAmounts = aiRes ? aiRes.valid.map((o) => o.amount).filter((n) => n > 0) : []
  const completeness = reconcileCompleteness(sourceText, [...collectAmounts(items), ...rawAiAmounts])

  return { items, aiRejected, completeness, crosscheckConflicts, detSupplemented, aiItemsCount }
}
