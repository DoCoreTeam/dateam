/**
 * 수주 매출 SSOT — 세 숫자가 각자 다른 질문에 답한다
 *
 * **왜 셋인가**: «장부가 명확해야 해»는 «숫자를 하나로 정하라»가 아니라
 * **숫자가 여러 개인 것을 인정하고 각각을 제자리에 두라**는 뜻이었다.
 *
 *   · 수주 매출  «얼마짜리 사업을 땄나»  → 전체 사업비. 영업 실적·목표의 기준
 *   · 현물 제외  «실제로 돈이 얼마 오가나» → 수주 매출 − 현물
 *   · 수익 인식  «회계상 매출은»          → 국비 + 지방비만
 *
 * **기준은 «돈이 움직였나» 하나다.** 자부담 «현금»은 우리 돈이지만 사업 계좌로 나가
 * 사업비로 집행되고 정산 대상이라 수주 매출에 들어간다.
 * 현물만 어느 계좌에서도 움직이지 않아 «현물 제외»에서 빠진다.
 *
 * **현물 제외는 저장하지 않는다.** 저장하면 둘이 어긋날 자리가 생기고,
 * 어긋나면 어느 쪽이 맞는지 아무도 모른다.
 */

import { computeTax, type TaxAmounts, type TaxBasis } from './money.ts'

/** 재원 네 갈래. 국가 과제에서만 쓰인다 */
export type FundingSourceType = 'NATIONAL' | 'LOCAL' | 'OWN_CASH' | 'IN_KIND'

export interface FundingSourceInput {
  sourceType: FundingSourceType
  amountMinor: bigint | number | string
}

/** 재원의 성질은 종류에서 파생된다 — 행마다 손으로 넣지 않는다 */
export function isCashInflow(t: FundingSourceType): boolean {
  return t !== 'IN_KIND'
}
export function countsAsAccountingRevenue(t: FundingSourceType): boolean {
  return t === 'NATIONAL' || t === 'LOCAL'
}
/** 법령상 정부출연금과 구분해 별도 금융계좌로 관리해야 하는 재원 */
export function needsSeparateAccount(t: FundingSourceType): boolean {
  return t === 'OWN_CASH'
}

export const FUNDING_LABEL: Record<FundingSourceType, string> = {
  NATIONAL: '국비',
  LOCAL: '지방비',
  OWN_CASH: '자부담 현금',
  IN_KIND: '자부담 현물',
}

export interface InKindInput {
  valueMinor: bigint | number | string
}

export interface BookedInput {
  /** 수주 매출의 원본 금액 */
  amountMinor: bigint | number | string | null | undefined
  /** 원본이 공급가액인가 총액인가. 국가 과제 사업비는 GROSS 가 기본 */
  taxBasis?: TaxBasis
  taxRatePct?: number | string
  /** 현물 명세. 비어 있으면 «현물 제외»를 그리지 않는다 */
  inKind?: readonly InKindInput[]
  /** 재원 구성. 비어 있으면 회계 수익 인식을 내지 않는다 */
  funding?: readonly FundingSourceInput[]
}

export interface BookedAmounts {
  /** 수주 매출 — 전체 사업비. 기본 화면의 큰 숫자 */
  bookedMinor: bigint
  /** 부가세 세 값 (수주 매출 기준) */
  tax: TaxAmounts
  /** 현물 합계 */
  inKindMinor: bigint
  /** 현물 제외 = 수주 매출 − 현물. 기본 화면 둘째 줄 */
  exInKindMinor: bigint
  /** 회계 수익 인식 = 국비 + 지방비. 재원이 없으면 null — «모른다»와 «0»은 다르다 */
  accountingRevenueMinor: bigint | null
  /** 실제 현금 유입 = 현물이 아닌 재원의 합. 재원이 없으면 null */
  cashInflowMinor: bigint | null
  /** 현물이 있는가 — false 면 화면이 «현물 제외»를 아예 안 그린다 */
  hasInKind: boolean
  /** 현물 비중 (표시 전용, 소수 1자리). 현물이 없으면 null */
  inKindRatioPct: number | null
}

function big(v: bigint | number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return BigInt(0)
  if (typeof v === 'bigint') return v
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? BigInt(Math.round(n)) : BigInt(0)
}

/**
 * 세 숫자를 한 번에 낸다. 화면도 서버도 이 함수만 부른다 —
 * **화면이 뺄셈을 하지 않는다.**
 */
export function computeBooked(input: BookedInput): BookedAmounts {
  const booked = big(input.amountMinor)
  const basis: TaxBasis = input.taxBasis ?? 'NET'
  const tax = computeTax({ amountMinor: booked, taxBasis: basis, taxRatePct: input.taxRatePct })

  const inKindList = input.inKind ?? []
  const inKindMinor = inKindList.reduce<bigint>((a, x) => a + big(x.valueMinor), BigInt(0))
  const hasInKind = inKindMinor > BigInt(0)

  const funding = input.funding ?? []
  const hasFunding = funding.length > 0
  const accountingRevenueMinor = hasFunding
    ? funding.reduce<bigint>((a, f) => (countsAsAccountingRevenue(f.sourceType) ? a + big(f.amountMinor) : a), BigInt(0))
    : null
  const cashInflowMinor = hasFunding
    ? funding.reduce<bigint>((a, f) => (isCashInflow(f.sourceType) ? a + big(f.amountMinor) : a), BigInt(0))
    : null

  return {
    bookedMinor: booked,
    tax,
    inKindMinor,
    exInKindMinor: booked - inKindMinor,
    accountingRevenueMinor,
    cashInflowMinor,
    hasInKind,
    inKindRatioPct: hasInKind && booked > BigInt(0)
      ? Math.round((Number(inKindMinor) / Number(booked)) * 1000) / 10
      : null,
  }
}

/**
 * 재원 목록에서 현물 합계를 뽑는다.
 *
 * 현물 명세(`crm_in_kind`)와 재원(`crm_funding_source`) 둘 다에 현물이 있을 수 있다 —
 * 명세가 정본이고 재원의 IN_KIND 행은 그 합계를 비추는 거울이다.
 * 어긋나면 **명세를 믿는다**(무엇을 뺐는지가 남는 쪽이 진실이다).
 */
export function inKindFromFunding(funding: readonly FundingSourceInput[]): bigint {
  return funding.reduce<bigint>((a, f) => (f.sourceType === 'IN_KIND' ? a + big(f.amountMinor) : a), BigInt(0))
}

/** 수주 매출은 «가장 확실한 것»을 쓴다 — 계약 > 견적 > 예산 */
export function pickBooked(d: {
  contractNetMinor?: bigint | number | string | null
  quotedNetMinor?: bigint | number | string | null
  budgetNetMinor?: bigint | number | string | null
}): { minor: bigint; from: 'contract' | 'quote' | 'budget' | 'none' } {
  const c = big(d.contractNetMinor)
  if (c > BigInt(0)) return { minor: c, from: 'contract' }
  const q = big(d.quotedNetMinor)
  if (q > BigInt(0)) return { minor: q, from: 'quote' }
  const b = big(d.budgetNetMinor)
  if (b > BigInt(0)) return { minor: b, from: 'budget' }
  return { minor: BigInt(0), from: 'none' }
}

export const BOOKED_FROM_LABEL: Record<'contract' | 'quote' | 'budget' | 'none', string> = {
  contract: '계약 금액',
  quote: '견적 금액',
  budget: '예산 금액',
  none: '금액 미정',
}
