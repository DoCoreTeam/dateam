// 제품 상세 창구가 돌려주는 모양 — 금액은 문자열 정수(원)

export interface ItemJson {
  id: string
  name: string
  unitPriceMinor: string
  unit: string | null
  taxRate: string
  section: string | null
  basis: string
  billing: string
  ratioPct: string | null
  ratioOfSection: string | null
  discountable: boolean
  remark: string | null
  needsReview: boolean
  isActive: boolean
  position: number
  version: number
}

export interface RuleJson {
  id: string
  kind: string
  body: Record<string, unknown>
  isEnabled: boolean
  disabledReason: string | null
  position: number
}

export interface SectionJson { name: string; roundingUnit: number }

export interface ProductJson {
  id: string
  name: string
  businessTypeKey: string
  descriptionMd: string | null
  sections: SectionJson[]
  tcoYears: number
  freeYears: number
  examples: { label: string; conditions: unknown; expectOnceMinor: string; expectAnnualMinor: string; expectTcoMinor: string | null }[]
  isActive: boolean
  needsReview: boolean
  sourceFileName: string | null
  version: number
  updatedAt: string
  /** 가격 기준 버전 (마이그 317) */
  revision: number
  effectiveFrom: string | null
  discountStackMode: 'MAX' | 'MULTIPLY' | 'ADD'
  supplyRoundingUnit: number
}

export interface DetailJson {
  product: ProductJson
  items: ItemJson[]
  rules: RuleJson[]
}

export const won = (v: string | number | bigint | null | undefined): string =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('ko-KR')
