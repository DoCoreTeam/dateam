/**
 * 견적에 더해진 가격 기준 칸 — 받을 이름과 모양 (마이그 310)
 *
 * quote.ts 가 이미 1,900줄이라 새 칸을 여기 모은다. quote.ts 는 이 파일의 이름 목록을
 * 허용 칸에 펼쳐 넣고, 저장할 값은 이 파일의 함수로 만든다.
 *
 * 허용 칸 목록에 없는 칸은 조용히 버려지는 대신 거절된다(quote.ts rejectUnknownKeys).
 * 그래서 새 칸을 더할 때 이 목록을 빠뜨리면 저장이 「모르는 항목」으로 실패한다 — 조용히 0 이 되지 않는다.
 */

import { CrmError } from '../domain/errors.ts'
import { ROUNDING_UNITS } from '../domain/quote-math.ts'

export const LINE_PRICING_KEYS = [
  'listPriceMinor', 'priceSource', 'provenance', 'billing', 'ratioPct', 'ratioOfSectionName', 'lockedFields',
] as const

export const QUOTE_PRICING_KEYS = ['budgetMinor', 'budgetIncludesTax', 'autoFilled', 'fillConditions', 'fillText'] as const

/** 말로 채우기에 쓴 글의 상한 — 마이그 312 의 CHECK 와 같은 값 */
export const MAX_FILL_TEXT = 8_000

const PRICE_SOURCES = ['LIST', 'LABOR', 'GPU', 'COST_MARGIN', 'MANUAL']
const LOCKABLE = ['unitPrice', 'quantity', 'discount', 'name']
const MAX_JSON_CHARS = 20_000

export interface LinePricingInput {
  listPriceMinor?: string | number | null
  priceSource?: string | null
  provenance?: unknown
  billing?: string | null
  ratioPct?: string | number | null
  ratioOfSectionName?: string | null
  lockedFields?: unknown
}

function minorOrNull(v: unknown, field: string): bigint | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!/^\d+$/.test(s)) throw new CrmError('VALIDATION_FAILED', '금액은 0 이상의 정수여야 합니다.', { field })
  return BigInt(s)
}

function smallJson(v: unknown, field: string, fallback: unknown): unknown {
  if (v === null || v === undefined) return fallback
  if (typeof v !== 'object') throw new CrmError('VALIDATION_FAILED', '형식이 틀렸습니다.', { field })
  const text = JSON.stringify(v)
  if (text.length > MAX_JSON_CHARS) throw new CrmError('VALIDATION_FAILED', '내용이 너무 깁니다.', { field })
  return JSON.parse(text)
}

/** 줄 하나의 새 칸. 비율 줄이면 isRatio 가 참이고 단가 수량은 저장 쪽이 1 과 0 으로 둔다 */
export function linePricingData(line: LinePricingInput): { data: Record<string, unknown>; isRatio: boolean } {
  const ratioRaw = line.ratioPct
  const isRatio = ratioRaw !== null && ratioRaw !== undefined && String(ratioRaw).trim() !== ''
  let ratioPct: number | null = null
  if (isRatio) {
    const n = Number(ratioRaw)
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new CrmError('VALIDATION_FAILED', '비율은 0에서 100 사이여야 합니다.', { field: 'ratioPct' })
    ratioPct = n
  }
  const priceSource = line.priceSource ? String(line.priceSource) : null
  if (priceSource && !PRICE_SOURCES.includes(priceSource)) {
    throw new CrmError('VALIDATION_FAILED', `모르는 가격 기준입니다: ${priceSource}`, { field: 'priceSource' })
  }
  if (line.billing && line.billing !== 'ONCE' && line.billing !== 'ANNUAL') {
    throw new CrmError('VALIDATION_FAILED', `모르는 청구입니다: ${line.billing}`, { field: 'billing' })
  }
  const locked = Array.isArray(line.lockedFields) ? line.lockedFields.filter((x): x is string => typeof x === 'string' && LOCKABLE.includes(x)) : []
  return {
    isRatio,
    data: {
      listPriceMinor: minorOrNull(line.listPriceMinor, 'listPriceMinor'),
      priceSource,
      provenance: smallJson(line.provenance, 'provenance', {}),
      billing: line.billing === 'ANNUAL' ? 'ANNUAL' : line.billing === 'ONCE' ? 'ONCE' : null,
      ratioPct,
      ratioOfSectionName: isRatio && line.ratioOfSectionName ? String(line.ratioOfSectionName).trim().slice(0, 100) : null,
      lockedFields: locked,
    },
  }
}

export interface QuotePricingInput {
  budgetMinor?: string | number | null
  budgetIncludesTax?: boolean | null
  autoFilled?: unknown
  fillConditions?: unknown
  fillText?: string | null
}

/** 견적의 새 칸 — 안 보낸 칸은 결과에서 빠진다(고칠 때 덮지 않게) */
export function quotePricingData(input: QuotePricingInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.budgetMinor !== undefined) {
    const b = minorOrNull(input.budgetMinor, 'budgetMinor')
    out.budgetMinor = b === null || b === BigInt(0) ? null : b
  }
  if (input.budgetIncludesTax !== undefined) out.budgetIncludesTax = input.budgetIncludesTax === true
  if (input.autoFilled !== undefined) out.autoFilled = Array.isArray(input.autoFilled) ? smallJson(input.autoFilled.slice(0, 50), 'autoFilled', []) : []
  if (input.fillConditions !== undefined) out.fillConditions = smallJson(input.fillConditions, 'fillConditions', {})
  if (input.fillText !== undefined) {
    const t = input.fillText === null ? '' : String(input.fillText)
    if (t.length > MAX_FILL_TEXT) throw new CrmError('VALIDATION_FAILED', `글이 너무 깁니다. ${MAX_FILL_TEXT.toLocaleString('ko-KR')}자 이내로 줄여 주세요.`, { field: 'fillText' })
    out.fillText = t.trim() === '' ? null : t
  }
  return out
}

/** 묶음의 새 칸 — 묶음 절사와 사업 유형 */
export function sectionPricingData(s: { roundingUnit?: number | string | null; businessTypeKey?: string | null }): Record<string, unknown> {
  const unit = Math.trunc(Number(s.roundingUnit ?? 0)) || 0
  if (!(ROUNDING_UNITS as readonly number[]).includes(unit)) {
    throw new CrmError('VALIDATION_FAILED', '묶음 절사 단위가 틀렸습니다.', { field: 'sections' })
  }
  return { roundingUnit: unit, businessTypeKey: s.businessTypeKey ? String(s.businessTypeKey).slice(0, 50) : null }
}

/**
 * 공개 API 로 내보내지 않는 칸 — 공개 모양은 마이그 310 전 그대로 둔다.
 * 자동으로 채운 값, 조건, 출처는 우리 쪽 작업 기록이고 예산은 협상 정보다.
 */
export const QUOTE_PUBLIC_HIDDEN = [
  'annualMinor', 'sectionRoundingMinor', 'budgetMinor', 'budgetIncludesTax', 'autoFilled', 'fillConditions', 'priceBasisDate', 'fillText',
] as const

export function withoutPricingFields<T extends Record<string, unknown>>(row: T): Omit<T, (typeof QUOTE_PUBLIC_HIDDEN)[number]> {
  const out = { ...row }
  for (const k of QUOTE_PUBLIC_HIDDEN) delete (out as Record<string, unknown>)[k]
  return out
}
