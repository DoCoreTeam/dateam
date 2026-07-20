// AI 구조화 관측(structured observation) 계약 — SSOT.
//   철학: AI=인식(무한 경우의 수 — 통화기호·주기표기·모델 별칭을 다 안다), 코드=산술+검증(결정론).
//   AI에게 절대 나눗셈·환산을 시키지 않는다 — AI는 원문 그대로의 (금액·통화·주기·분모)만 보고하고,
//   전량 산술은 이 파일의 observationToKrwPerGpuHour 1곳에서만 수행한다(하드코딩 재계산 금지).
//   재발 방지 대상(2026-07-20 실화면 6건): 전각 ￥ 미인식, 月額 주기 소실, "1,000円/100GB" 100배 과대,
//   "1x" 수량접두 잔류, 경쟁사 화이트리스트 미등록, 피벗/산문 배타 — 전부 "코드가 자기 표로 재판정"해서 난 사고.

import { HOURS_PER_PERIOD, type HourPeriod } from './hours.ts'
import { amountToKrw, type FxKrwMap } from './normalize-money.ts'

export type ObservationUnit = HourPeriod | 'per_gb' | 'per_account'
export type ComponentKind = 'flat' | 'base_fee' | 'usage' | 'storage'
export type MatchBasis = 'exact' | 'spec' | 'none'
export type PriceTier = 'on_demand' | 'spot' | 'reserved'
export type FormFactor = 'SXM' | 'PCIe' | 'NVL' | null

const TIME_UNITS: readonly HourPeriod[] = ['minute', 'hour', 'day', 'week', 'month', 'year']
const ALL_UNITS: readonly ObservationUnit[] = [...TIME_UNITS, 'per_gb', 'per_account']
const FORM_FACTORS: readonly Exclude<FormFactor, null>[] = ['SXM', 'PCIe', 'NVL']
const COMPONENT_KINDS: readonly ComponentKind[] = ['flat', 'base_fee', 'usage', 'storage']
const MATCH_BASES: readonly MatchBasis[] = ['exact', 'spec', 'none']
// 요금 등급(비교축) — 같은 모델이라도 on_demand/spot/reserved는 서로 다른 상품이다.
//   실사고 v0.7.363: verda 요금표가 'Price | Spot price' 2열인데 spot 열을 통째로 버리고 있었다
//   (완전성 게이트가 미커버 56건으로 지목). 버리지 말고 별도 축으로 보존한다.
const PRICE_TIERS: readonly PriceTier[] = ['on_demand', 'spot', 'reserved']

/** AI가 채우는 구조화 관측 — 산술 절대 금지, 원문 근거 그대로. */
export interface AiObservation {
  competitor_name: string
  model: string
  form_factor: FormFactor
  memory_gb: number | null
  gpu_count: number
  amount: number
  currency: string
  unit: ObservationUnit
  per_qty: number
  component_kind: ComponentKind
  catalog_match: string | null
  match_basis: MatchBasis
  /** 요금 등급. 같은 모델의 on_demand/spot/reserved는 별개 상품 — 섞으면 시세 밴드가 왜곡된다. 미지정 시 unit에서 파생. */
  price_tier: PriceTier
  provenance: string
}

export type ObservationRejectReason =
  | 'missing_field'
  | 'invalid_type'
  | 'invalid_enum'
  | 'invalid_number'
  | 'empty_provenance'
  | 'catalog_match_mismatch'
  // 접두 혼동(GB300↔B300·GB200↔B200) — 이름이 비슷해 AI가 억지 매칭한 경우. 미등록으로 돌린다.
  | 'prefix_confusion'

export interface ObservationValidationOk {
  ok: true
  value: AiObservation
}

export interface ObservationValidationFail {
  ok: false
  reason: ObservationRejectReason
  detail: string
}

export type ObservationValidationResult = ObservationValidationOk | ObservationValidationFail

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function fail(reason: ObservationRejectReason, detail: string): ObservationValidationFail {
  return { ok: false, reason, detail }
}

/**
 * AI 원시 출력 → 검증된 AiObservation. enum 밖 값·음수·NaN·빈 provenance는 전부 거부한다.
 * per_qty 누락은 1로 보정(기본 분모=1), 0/음수/비유한값은 거부.
 * AI 출력을 무검증 채택하지 않는다 — 이 함수를 거치지 않은 AiObservation은 하류에서 사용 금지.
 */
// 모델 키 정규화(비교 전용) — 소문자 + 공백/하이픈/언더바 제거.
const normKey = (v: string): string => v.toLowerCase().replace(/[\s\-_]+/g, '')

export function validateAiObservation(raw: unknown): ObservationValidationResult {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_type', 'raw observation is not an object')
  const r = raw as Record<string, unknown>

  if (!isNonEmptyString(r.competitor_name)) return fail('missing_field', 'competitor_name')
  if (!isNonEmptyString(r.model)) return fail('missing_field', 'model')
  if (!isNonEmptyString(r.currency)) return fail('missing_field', 'currency')
  if (!isNonEmptyString(r.unit)) return fail('missing_field', 'unit')
  if (!isNonEmptyString(r.component_kind)) return fail('missing_field', 'component_kind')
  if (!isNonEmptyString(r.match_basis)) return fail('missing_field', 'match_basis')
  if (!isNonEmptyString(r.provenance)) return fail('empty_provenance', 'provenance is required')

  const formFactorRaw = r.form_factor
  let form_factor: FormFactor = null
  if (formFactorRaw !== null && formFactorRaw !== undefined) {
    if (typeof formFactorRaw !== 'string' || !FORM_FACTORS.includes(formFactorRaw as never)) {
      return fail('invalid_enum', `form_factor: ${String(formFactorRaw)}`)
    }
    form_factor = formFactorRaw as Exclude<FormFactor, null>
  }

  if (!ALL_UNITS.includes(r.unit as ObservationUnit)) return fail('invalid_enum', `unit: ${String(r.unit)}`)

  // price_tier: 미지정이면 unit에서 파생(월/년=약정, 그 외=on_demand) — 기존 동작과 동일한 안전 기본값.
  //   AI가 'spot' 등을 명시하면 그대로 채택. enum 밖 값은 거부(무단 어휘 확장 차단).
  let price_tier: PriceTier
  if (r.price_tier === null || r.price_tier === undefined || r.price_tier === '') {
    price_tier = r.unit === 'month' || r.unit === 'year' ? 'reserved' : 'on_demand'
  } else if (PRICE_TIERS.includes(r.price_tier as PriceTier)) {
    price_tier = r.price_tier as PriceTier
    // 단위가 월/년이면 시간제(on_demand)일 수 없다 — 약정으로 교정한다.
    //   실사고 v0.7.363: price_tier 도입 후 AI가 소프트뱅크 월정액(2,500,000엔/월)을 on_demand로 보고해
    //   시간제와 같은 밴드에 섞일 뻔했다. 단위는 원문에 명시된 사실이라 AI의 등급 추정보다 신뢰도가 높다.
    //   spot은 존중한다(월 단위 spot 상품이 있을 수 있고, 그건 별도 축이다).
    if ((r.unit === 'month' || r.unit === 'year') && price_tier === 'on_demand') price_tier = 'reserved'
  } else {
    return fail('invalid_enum', `price_tier: ${String(r.price_tier)}`)
  }
  if (!COMPONENT_KINDS.includes(r.component_kind as ComponentKind)) return fail('invalid_enum', `component_kind: ${String(r.component_kind)}`)
  if (!MATCH_BASES.includes(r.match_basis as MatchBasis)) return fail('invalid_enum', `match_basis: ${String(r.match_basis)}`)

  // catalog_match/match_basis 정합: match_basis='none'이면 catalog_match는 null이어야 한다(확신 없으면 고르지 말라는 계약 강제).
  const catalogMatchRaw = r.catalog_match
  let catalog_match: string | null = null
  if (catalogMatchRaw !== null && catalogMatchRaw !== undefined) {
    if (typeof catalogMatchRaw !== 'string' || catalogMatchRaw.trim().length === 0) {
      return fail('invalid_type', 'catalog_match must be string or null')
    }
    catalog_match = catalogMatchRaw
  }
  if (r.match_basis === 'none' && catalog_match !== null) {
    return fail('catalog_match_mismatch', 'match_basis=none requires catalog_match=null')
  }
  if (r.match_basis !== 'none' && catalog_match === null) {
    return fail('catalog_match_mismatch', `match_basis=${String(r.match_basis)} requires non-null catalog_match`)
  }

  // ★ 접두 오매핑 차단(결정론 가드) — 프롬프트만으로는 못 막는다(실측: GB300을 B300(exact)으로 매핑).
  //   "GB300"과 "B300", "GB200"과 "B200"은 한 글자 차이지만 완전히 다른 제품이다(GB=Grace CPU 결합).
  //   catalog_match가 model의 **접미 부분일치**인데 앞에 글자가 더 붙어 있으면 = AI가 비슷해서 고른 것 → 거부.
  //   같은 이유로 반대 방향(model이 catalog_match의 접미)도 거부한다.
  //   대조 기준은 catalog_match가 아니라 **provenance(원문 근거)** 다 — 실측에서 AI가 catalog_match뿐 아니라
  //   model 필드 자체를 "B300"으로 바꿔 적었고(원문은 GB300), 둘을 비교하면 같아서 못 잡았다.
  //   원문 근거는 정직하게 남아 있으므로 그것을 앵커로 삼는다.
  const provTokens = String(r.provenance ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean).map(normKey)
  if (provTokens.length > 0) {
    const mk = normKey(String(r.model))
    if (!provTokens.includes(mk)) {
      const confused = provTokens.find((t) => t.endsWith(mk) && t.length > mk.length)
      if (confused) {
        return fail('prefix_confusion',
          `모델 "${String(r.model)}"이 원문 "${confused}"의 접미 — 접두가 다른 별개 제품(GB300≠B300). 자동매칭 금지, 미등록 처리`)
      }
    }
  }

  // memory_gb: null 허용, 숫자면 양수·유한
  const memoryRaw = r.memory_gb
  let memory_gb: number | null = null
  if (memoryRaw !== null && memoryRaw !== undefined) {
    if (typeof memoryRaw !== 'number' || !Number.isFinite(memoryRaw) || memoryRaw <= 0) {
      return fail('invalid_number', `memory_gb: ${String(memoryRaw)}`)
    }
    memory_gb = memoryRaw
  }

  // gpu_count: 미상이면 1(스펙 기본값), 있으면 양의 정수
  const gpuCountRaw = r.gpu_count
  let gpu_count = 1
  if (gpuCountRaw !== null && gpuCountRaw !== undefined) {
    if (typeof gpuCountRaw !== 'number' || !Number.isFinite(gpuCountRaw) || gpuCountRaw <= 0) {
      return fail('invalid_number', `gpu_count: ${String(gpuCountRaw)}`)
    }
    gpu_count = gpuCountRaw
  }

  // amount: 필수, 양수·유한 (원본 금액 그대로 — 환산 금지)
  const amountRaw = r.amount
  if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw) || amountRaw <= 0) {
    return fail('invalid_number', `amount: ${String(amountRaw)}`)
  }

  // per_qty: 누락 시 1로 보정, 0/음수/비유한 거부
  const perQtyRaw = r.per_qty
  let per_qty = 1
  if (perQtyRaw !== null && perQtyRaw !== undefined) {
    if (typeof perQtyRaw !== 'number' || !Number.isFinite(perQtyRaw) || perQtyRaw <= 0) {
      return fail('invalid_number', `per_qty: ${String(perQtyRaw)}`)
    }
    per_qty = perQtyRaw
  }

  const value: AiObservation = {
    competitor_name: (r.competitor_name as string).trim(),
    model: (r.model as string).trim(),
    form_factor,
    memory_gb,
    gpu_count,
    amount: amountRaw,
    currency: (r.currency as string).trim().toUpperCase(),
    unit: r.unit as ObservationUnit,
    per_qty,
    component_kind: r.component_kind as ComponentKind,
    catalog_match,
    match_basis: r.match_basis as MatchBasis,
    price_tier,
    provenance: (r.provenance as string).trim(),
  }
  return { ok: true, value }
}

function isTimeUnit(unit: ObservationUnit): unit is HourPeriod {
  return (TIME_UNITS as readonly string[]).includes(unit)
}

/**
 * 검증된 AiObservation → KRW per 단일 GPU per hour. per_gb·per_account는 시간축 정규화 불가이므로 null.
 * 산술 순서(전부 코드): amount/per_qty(분모 분리) → KRW 환산(amountToKrw) → 시간환산(HOURS_PER_PERIOD, SSOT=hours.ts) → /gpu_count.
 */
export function observationToKrwPerGpuHour(obs: AiObservation, fx: FxKrwMap): number | null {
  // 대표가(GPU 1장·1시간 시세)는 **GPU 사용량에 비례하는 성분만** 해당한다.
  //   base_fee = 계정 고정비(GPU 몇 장을 쓰든 동일), storage = 용량 요금 → GPU 시간단가로 환산하면
  //   의미가 왜곡되고 시장 밴드까지 끌어내린다(실측: 소프트뱅크 기본료 30,000엔/월이 $0.257 시세로 표시됨).
  //   두 성분은 버리지 않고 components로 보존한다(무손실) — 실효비용 합산은 scenario-cost가 담당.
  if (obs.component_kind === 'base_fee' || obs.component_kind === 'storage') return null
  if (!isTimeUnit(obs.unit)) return null
  const perUnitAmount = obs.amount / obs.per_qty
  const krw = amountToKrw(perUnitAmount, obs.currency, fx)
  if (krw === null) return null
  const hours = HOURS_PER_PERIOD[obs.unit]
  if (!Number.isFinite(hours) || hours <= 0) return null
  const perHour = krw / hours
  return perHour / obs.gpu_count
}
