/**
 * 가격 기준 넷 가운데 셋 — 등급 단가, GPU 판매가, 원가와 마진율
 *
 * 품목 정상가는 `solution-engine.ts` 가 맡는다. 여기 셋은 줄 하나를 만드는 규칙이다.
 * 계산은 이미 있는 것을 부른다. GPU 시간 환산은 GPU 가격표의 월 기준 시간(720)을 그대로 쓰고,
 * 원가에서 판매가는 `sellFromCost` 를 쓴다. 이 파일이 따로 셈을 지어내지 않는다.
 */

import { HOURS_PER_MONTH } from '../../../gpu/hours.ts'
import { sellFromCost } from '../quote-margin.ts'
import { toMinor } from '../money.ts'
import type { Provenance, ProvenanceSource } from './types.ts'

/** 공표 노임단가(KOSA SW 기술자 평균임금, 월). RFP R06 의 기본값과 같은 한 벌 */
export const PUBLIC_LABOR_RATES_KRW: Readonly<Record<LaborGradeName, number>> = {
  특급: 9_500_000,
  고급: 7_800_000,
  중급: 6_200_000,
  초급: 4_800_000,
}
export type LaborGradeName = '특급' | '고급' | '중급' | '초급'
export const LABOR_GRADE_NAMES: readonly LaborGradeName[] = ['특급', '고급', '중급', '초급']

/** 말하지 않았을 때의 등급과 인원 */
export const DEFAULT_LABOR_GRADE: LaborGradeName = '중급'
export const DEFAULT_HEADCOUNT = 1

/**
 * 빈칸을 채우는 순서 — 앞에 있을수록 이긴다. 엔진 한 곳에서만 판정한다.
 * 들어온 순서대로 덮으면 마지막에 누가 눌렀느냐로 금액이 바뀐다.
 */
export const FILL_PRECEDENCE: readonly ProvenanceSource[] = [
  'HUMAN', 'SAID', 'BUDGET', 'RULE', 'PRICEBOOK', 'GPU_PRICE', 'COST_MARGIN',
  'LAST_QUOTE', 'PUBLIC_LABOR', 'COMPANY_KIND', 'DEAL_BUDGET', 'DEFAULT', 'UNVERIFIED',
]

export interface Candidate<T> {
  value: T | null | undefined
  provenance: Provenance
}

/** 값이 있는 후보 가운데 순서가 가장 앞선 것. 하나도 없으면 null */
export function pickFirst<T>(candidates: readonly Candidate<T>[]): { value: T; provenance: Provenance } | null {
  const rank = (s: ProvenanceSource) => {
    const i = FILL_PRECEDENCE.indexOf(s)
    return i < 0 ? FILL_PRECEDENCE.length : i
  }
  const present = candidates.filter((c) => c.value !== null && c.value !== undefined && !(typeof c.value === 'string' && c.value.trim() === ''))
  if (present.length === 0) return null
  const best = [...present].sort((a, b) => rank(a.provenance.source) - rank(b.provenance.source))[0]
  return { value: best.value as T, provenance: best.provenance }
}

// ── 등급 단가 ──────────────────────────────────────────────────────────────

export interface LaborGradeRef {
  id: string | null
  name: string
  /** 우리 판매 단가(월). 없으면 공표 노임단가 */
  pricePerMmMinor: bigint | null
}

export interface LaborInput {
  grade: string | null
  headcount: number | null
  months: number | null
  saidUnitPriceMinor?: bigint | null
}

export interface BasisLine {
  name: string
  kind: 'QUANTITY' | 'EFFORT' | 'PERIOD'
  quantity: number
  unit: string
  unitPriceMinor: bigint
  durationValue: number | null
  durationUnit: 'MONTH' | 'HOUR' | null
  priceBasis: 'HOUR' | 'MONTH' | null
  hoursPerMonth: number | null
  laborGradeId: string | null
  listPriceMinor: bigint | null
  formula: string
  provenance: { unitPrice: Provenance; quantity: Provenance }
  autoFilled: { field: string; value: string; provenance: Provenance }[]
}

function isGradeName(v: string): v is LaborGradeName {
  return (LABOR_GRADE_NAMES as readonly string[]).includes(v)
}

const won = (v: bigint | number) => Number(v).toLocaleString('ko-KR')

/**
 * 공수 줄. 단가 = 말한 값 → 우리 판매 단가 → 공표 노임단가. 수량은 인원 × 개월(M/M).
 */
export function laborLine(name: string, input: LaborInput, grades: readonly LaborGradeRef[]): BasisLine | null {
  const autoFilled: BasisLine['autoFilled'] = []
  const gradeName = input.grade && input.grade.trim() !== '' ? input.grade.trim() : DEFAULT_LABOR_GRADE
  if (!input.grade) autoFilled.push({ field: '등급', value: gradeName, provenance: { source: 'DEFAULT', note: '기본값' } })
  const headcount = input.headcount ?? DEFAULT_HEADCOUNT
  if (input.headcount === null) autoFilled.push({ field: '인원', value: `${headcount}명`, provenance: { source: 'DEFAULT', note: '기본값' } })
  const months = input.months
  if (months === null || !(months > 0)) return null

  const ref = grades.find((g) => g.name === gradeName) ?? null
  const picked = pickFirst<bigint>([
    { value: input.saidUnitPriceMinor ?? null, provenance: { source: 'SAID' } },
    { value: ref?.pricePerMmMinor ?? null, provenance: { source: 'PRICEBOOK', note: '우리 판매 단가' } },
    {
      value: isGradeName(gradeName) ? BigInt(PUBLIC_LABOR_RATES_KRW[gradeName]) : null,
      provenance: { source: 'PUBLIC_LABOR', note: '우리 판매 단가가 없어 공표 노임단가로 채움' },
    },
  ])
  if (!picked) return null
  if (picked.provenance.source === 'PUBLIC_LABOR') {
    autoFilled.push({ field: `${gradeName} 등급 단가`, value: `${won(picked.value)}원`, provenance: picked.provenance })
  }
  const mm = headcount * months
  return {
    name,
    kind: 'EFFORT',
    quantity: mm,
    unit: 'M/M',
    unitPriceMinor: picked.value,
    durationValue: null,
    durationUnit: null,
    priceBasis: null,
    hoursPerMonth: null,
    laborGradeId: ref?.id ?? null,
    listPriceMinor: picked.provenance.source === 'SAID' ? (ref?.pricePerMmMinor ?? null) : picked.value,
    formula: `${won(picked.value)} × ${mm} M/M`,
    provenance: { unitPrice: picked.provenance, quantity: { source: input.headcount === null ? 'DEFAULT' : 'SAID' } },
    autoFilled,
  }
}

// ── GPU 판매가 ─────────────────────────────────────────────────────────────

export interface GpuPriceRef {
  model: string
  /** 그 구성의 시간당 판매가(원) — 전략가가 있으면 전략가 */
  hourlyKrw: number | null
  /** 그 구성의 GPU 장수. 1장당으로 나눈다 */
  gpuCount: number
}

export interface GpuUsageInput {
  model: string
  count: number
  /** 개월. 말하지 않으면 1 */
  months: number | null
  saidMonthlyMinor?: bigint | null
}

/**
 * GPU 이용 줄 — 1장당 시간당 판매가 × 대수 × (개월 × 월 기준 시간).
 * 단가 칸에는 월 단가를 적는다. 견적서가 「936,000원/월」로 읽어야 해서다.
 */
export function gpuUsageLine(input: GpuUsageInput, price: GpuPriceRef | null): BasisLine | null {
  const autoFilled: BasisLine['autoFilled'] = []
  const months = input.months ?? 1
  if (input.months === null) autoFilled.push({ field: '기간', value: '1개월', provenance: { source: 'DEFAULT', note: '기본값' } })
  const perCardHourly = price && price.hourlyKrw !== null && price.gpuCount > 0 ? Math.round(price.hourlyKrw / price.gpuCount) : null
  const listMonthly = perCardHourly !== null ? BigInt(perCardHourly * HOURS_PER_MONTH) : null
  const picked = pickFirst<bigint>([
    { value: input.saidMonthlyMinor ?? null, provenance: { source: 'SAID' } },
    { value: listMonthly, provenance: { source: 'GPU_PRICE', note: `GPU 가격표 시간당 ${won(perCardHourly ?? 0)}원 × ${HOURS_PER_MONTH}시간` } },
  ])
  if (!picked || !(input.count > 0)) return null
  return {
    name: `${input.model} GPU 이용`,
    kind: 'PERIOD',
    quantity: input.count,
    unit: '대',
    unitPriceMinor: picked.value,
    durationValue: months,
    durationUnit: 'MONTH',
    priceBasis: 'MONTH',
    hoursPerMonth: HOURS_PER_MONTH,
    laborGradeId: null,
    listPriceMinor: listMonthly,
    formula: `${won(picked.value)}/월 × ${input.count}대 × ${months}개월`,
    provenance: { unitPrice: picked.provenance, quantity: { source: 'SAID' } },
    autoFilled,
  }
}

// ── 원가와 마진율 ──────────────────────────────────────────────────────────

/** 마진율의 가운데 값 — 지난 견적의 마진율이 여럿이면 가운데 */
export function medianPct(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round(((xs[mid - 1] + xs[mid]) / 2) * 100) / 100
}

export interface CostMarginInput {
  name: string
  quantity: number
  unit: string | null
  costMinor: bigint | number | string
  saidMarginPct?: number | null
  /** 같은 품목의 지난 견적 마진율 */
  lastQuoteMarginPct?: number | null
  /** 하드웨어 지난 견적 마진율들 */
  peerMarginPcts?: readonly number[]
  fallbackMarginPct: number
}

/** 판매가 = 원가 ÷ (1 − 마진율). 마진율 = 말한 값 → 같은 품목 지난 견적 → 하드웨어 지난 견적 가운데 값 → 기본값 */
export function costMarginLine(input: CostMarginInput): BasisLine {
  const autoFilled: BasisLine['autoFilled'] = []
  const picked = pickFirst<number>([
    { value: input.saidMarginPct ?? null, provenance: { source: 'SAID' } },
    { value: input.lastQuoteMarginPct ?? null, provenance: { source: 'LAST_QUOTE', note: '같은 품목의 지난 견적' } },
    { value: medianPct(input.peerMarginPcts ?? []), provenance: { source: 'LAST_QUOTE', note: '하드웨어 지난 견적들의 가운데 값' } },
    { value: input.fallbackMarginPct, provenance: { source: 'DEFAULT', note: '기본값' } },
  ])!
  if (picked.provenance.source !== 'SAID') {
    autoFilled.push({ field: '마진율', value: `${picked.value}%`, provenance: picked.provenance })
  }
  const cost = toMinor(input.costMinor)
  const unit = sellFromCost(cost, picked.value)
  return {
    name: input.name,
    kind: 'QUANTITY',
    quantity: input.quantity,
    unit: input.unit ?? '개',
    unitPriceMinor: unit,
    durationValue: null,
    durationUnit: null,
    priceBasis: null,
    hoursPerMonth: null,
    laborGradeId: null,
    listPriceMinor: unit,
    formula: `원가 ${won(cost)} ÷ (1 − ${picked.value}%)`,
    provenance: { unitPrice: { source: 'COST_MARGIN', note: `마진율 ${picked.value}%` }, quantity: { source: 'SAID' } },
    autoFilled,
  }
}
