/**
 * 제품으로 채우기의 결과 → 편집 초안 (순수 함수)
 *
 * 엔진(미리 계산 창구)이 낸 줄을 초안의 묶음과 줄로 옮긴다. 금액을 다시 세지 않는다 —
 * 단가 할인율 비율과 그날 정상가와 출처를 그대로 싣고, 합계는 서버와 같은 priceQuote 가 센다.
 *
 * 빈 견적(이름 없는 줄 하나뿐)이면 통째로 바꾸고, 이미 줄이 있으면 뒤에 묶음째 붙인다.
 * 같은 이름의 묶음이 이미 있으면 그 묶음에 넣지 않고 새로 만든다 — 사람이 만든 묶음과 섞이면 비율 대상이 흐려진다.
 */

import type { QuoteDraft, QuoteLineDraft } from '../quote-draft-shape'
import type { QuoteLineKind } from '@/lib/terms/cost'

/** 미리 계산 창구가 주는 줄 — 금액은 문자열 정수 */
export interface EngineLineJson {
  key: string
  itemId: string
  name: string
  sectionKey: string | null
  quantity: number | string
  unit: string | null
  unitPriceMinor: string
  listPriceMinor: string | null
  discountPercent: number | string | null
  taxRate: number | string | null
  billing: 'ONCE' | 'ANNUAL' | null
  ratioPct: number | string | null
  ratioOfSectionKey: string | null
  remark: string | null
  provenance: Record<string, unknown>
  discountable?: boolean
}

export interface AutoFilledJson {
  field: string
  value: string
  provenance: { source: string; note?: string | null }
}

export interface ApplyInput {
  productId: string
  productName: string
  sections: { name: string; roundingUnit: number }[]
  /** 제품의 할인 후 공급가 절사 단위 — 견적이 받아 저장해 다시 계산해도 같은 금액이 된다 */
  supplyRoundingUnit?: number
  /** 채운 그때 제품의 가격 기준 버전 — 줄마다 남아 기준이 바뀌면 보내기 전에 알린다 */
  revision?: number | null
  lines: EngineLineJson[]
  autoFilled: AutoFilledJson[]
  conditions: Record<string, unknown>
}

function isBlank(d: QuoteDraft): boolean {
  return d.sections.length === 0 && d.lines.every((l) => l.name.trim() === '')
}

export function applyProductFill(draft: QuoteDraft, input: ApplyInput): QuoteDraft {
  const base = isBlank(draft) ? { ...draft, sections: [], lines: [] as QuoteLineDraft[] } : draft
  const used = input.sections.filter((s) => input.lines.some((l) => l.sectionKey === s.name))
  const offset = base.sections.length
  const indexOf = new Map(used.map((s, i) => [s.name, offset + i]))
  const sections = [...base.sections, ...used.map((s) => ({ name: s.name, roundingUnit: s.roundingUnit, businessTypeKey: null }))]

  const lines: QuoteLineDraft[] = input.lines.map((l) => {
    const isRatio = l.ratioPct !== null && l.ratioPct !== undefined && String(l.ratioPct) !== ''
    const kind: QuoteLineKind = isRatio ? 'RATIO' : 'QUANTITY'
    return {
      productId: l.itemId,
      name: l.name,
      descriptionMd: '',
      remark: l.remark ?? '',
      kind,
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      unitPriceMinor: String(l.unitPriceMinor),
      discountPercent: String(Number(l.discountPercent ?? 0)),
      specialDiscountPercent: '',
      taxRate: String(Number(l.taxRate ?? 10)),
      sectionIndex: l.sectionKey !== null ? (indexOf.get(l.sectionKey) ?? null) : null,
      listPriceMinor: l.listPriceMinor,
      priceSource: 'LIST',
      // 할인 대상인지도 출처와 함께 둔다 — 예산 맞추기가 구축비와 비율 줄을 건드리지 않게
      provenance: { ...l.provenance, discountable: l.discountable !== false },
      billing: l.billing,
      ratioPct: isRatio ? String(l.ratioPct) : null,
      ratioOfSectionName: isRatio ? l.ratioOfSectionKey : null,
      lockedFields: [],
      priceProductId: input.revision ? input.productId : null,
      priceProductRevision: input.revision ?? null,
    }
  })

  return {
    ...base,
    sections,
    lines: [...base.lines, ...lines],
    supplyRoundingUnit: input.supplyRoundingUnit ?? base.supplyRoundingUnit ?? 0,
    autoFilled: input.autoFilled,
    fillConditions: { productId: input.productId, productName: input.productName, conditions: input.conditions },
  }
}
