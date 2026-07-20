// 관측 원본의 성격(세그먼트·번들·세금·비교가능성)을 원문에서 결정론으로 판정 (확정 기획 P5).
//   AI 판단 아님 — 키워드 기반 결정론. 추출(전사/분류)이 원문을 주면 이 함수가 obs 성격 필드를 채운다.
//   비교불가(번들·최소약정)를 명확히 표시해 콕핏 밴드 오염을 막는 것이 목적.

// 번들/매니지드 신호 — 스토리지·네트워크·SW 포함, DGX/SuperPOD 세트, 월정액 플랜 등.
const BUNDLE_SIGNAL = /(dgx|superpod|プラン|plan\b|번들|bundle|스토리지 포함|storage included|インフラ|infiniband|nvlink|매니지드|managed|専有|전용 클러스터|クラスター)/i
// 스토리지·네트워크 포함 문구(감산 불가 번들 강도 ↑).
const INCLUSION_SIGNAL = /(ストレージ|storage|回線|network|ネットワーク|infiniband|nvlink|slurm|ai enterprise|스토리지|네트워크)/i
// 세금 표기.
const TAX_EXCLUDED = /(税別|tax[\s-]?excl|excl\.?\s?tax|부가세\s?별도|vat\s?excl|net of tax)/i
const TAX_INCLUDED = /(税込|tax[\s-]?incl|incl\.?\s?tax|부가세\s?포함|vat\s?incl)/i
// 비교불가 신호 — 최소약정·선불·문의견적.
const NONCOMPARABLE_SIGNAL = /(最低利用|최소\s?약정|min(imum)?\s?commit|선불|prepaid|お問い合わせ|contact\s?(us|sales)|커스텀\s?견적|custom quote|見積)/i

export type Segment = 'raw_gpu' | 'managed_bundle'
export type TaxBasis = 'tax_excluded' | 'tax_included' | 'unknown'

/** 원문(라벨+주변문맥)에서 세그먼트 판정. 번들/매니지드 신호 있으면 managed_bundle, 없으면 raw_gpu. */
export function inferSegment(text: string | null | undefined): Segment {
  return typeof text === 'string' && BUNDLE_SIGNAL.test(text) ? 'managed_bundle' : 'raw_gpu'
}

/** 스토리지·네트워크 등 포함 번들 여부(감산 불가 강도). */
export function inferBundleInclusive(text: string | null | undefined): boolean {
  return typeof text === 'string' && INCLUSION_SIGNAL.test(text)
}

/** 세금 기준(税別/税込). 미표기=unknown. */
export function inferTaxBasis(text: string | null | undefined): TaxBasis {
  if (typeof text !== 'string') return 'unknown'
  if (TAX_INCLUDED.test(text)) return 'tax_included'
  if (TAX_EXCLUDED.test(text)) return 'tax_excluded'
  return 'unknown'
}

/**
 * per-GPU·hr 비교 가능 여부. 비교불가 신호(최소약정·문의견적)나 번들가면 false(랭킹 제외·참고전용).
 * segment가 managed_bundle이면 기본 비교불가로 본다(억지 분해 금지 — 별도 트랙 표시).
 */
export function inferComparable(text: string | null | undefined, segment?: Segment): boolean {
  if (typeof text === 'string' && NONCOMPARABLE_SIGNAL.test(text)) return false
  if ((segment ?? inferSegment(text)) === 'managed_bundle') return false
  return true
}

export interface ObservationClass {
  segment: Segment
  bundle_inclusive: boolean
  tax_basis: TaxBasis
  comparable: boolean
}

/** 원문 하나로 관측 성격 4종 일괄 판정(추출 파이프라인이 obs 채울 때 호출). */
export function classifyObservation(text: string | null | undefined): ObservationClass {
  const segment = inferSegment(text)
  return {
    segment,
    bundle_inclusive: inferBundleInclusive(text),
    tax_basis: inferTaxBasis(text),
    comparable: inferComparable(text, segment),
  }
}
