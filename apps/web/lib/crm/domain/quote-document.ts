/**
 * 견적서 문서 모델 (SSOT) — 화면·인쇄·내보내기 셋이 같은 문서를 본다
 *
 * **왜 «문서»를 따로 정의하나**: 지금까지 견적은 «표 + 합계»였다. 그런데 고객에게
 * 나가는 것은 문서다 — 누가 누구에게, 언제, 어떤 조건으로 얼마를 제시했는지가
 * 한 장에 담겨야 한다. 그 구성을 화면마다 정하면 인쇄본과 엑셀이 서로 다른 말을 한다.
 * (실측: 인쇄 경로가 아예 없어 영업이 화면을 캡처해서 보내고 있었다.)
 *
 * **이 파일은 DB 를 모른다.** 순수 변환이라 테스트가 쉽고, 나중에 다른 문서
 * (거래명세서·계약서)를 만들 때 같은 방식으로 쓸 수 있다.
 *
 * **금액을 여기서 다시 계산하지 않는다.** 합계는 저장된 값을 그대로 싣는다 —
 * 문서가 스스로 계산하면 저장본과 인쇄본이 갈릴 수 있고, 그때 어느 쪽이 맞는지
 * 판정할 방법이 없다. 대신 `verifyDocument` 로 **어긋났는지만** 본다.
 *
 * **원가는 애초에 들어오지 않는다.** 입력 타입에 원가 자리가 없다 —
 * 지우는 것이 아니라 **담을 수 없게** 만드는 것이 유일하게 새지 않는 방법이다.
 */

import { QUOTE, hangulAmount, SUPPLIER_ORDER, SUPPLIER_LABEL, type SupplierField } from '../../terms/quote.ts'
import { checkI2, checkI5, type Violation } from './invariants.ts'

// ------------------------------------------------------------
// 문서의 모양
// ------------------------------------------------------------

/** 공급자(우리) — 설정에서 온다 */
export interface DocumentSupplier {
  name: string
  bizNo: string
  ceo: string
  address: string
  bizType: string
  bizItem: string
  contact: string
  /** 기본 거래 조건 — 견적마다 안 적어도 되도록 */
  terms: string
}

export interface DocumentCustomer {
  /** 회사명. 없으면 딜 이름으로 대신한다 — 「귀중」 앞이 비면 문서가 아니다 */
  companyName: string
  /** 수신 담당자 */
  personName: string | null
}

export interface DocumentLine {
  no: number
  name: string
  /** 규격·설명 */
  spec: string | null
  unit: string | null
  quantity: string
  unitPriceMinor: string
  discountPercent: string
  /** 할인 반영, 세금 제외 — 저장된 값 */
  amountMinor: string
}

export interface DocumentTotals {
  subtotalMinor: string
  discountMinor: string
  taxMinor: string
  totalMinor: string
  /** 「금 일억이천만원정」. 원 단위가 아니면 빈 문자열 */
  totalInWords: string
}

export interface QuoteDocument {
  documentTitle: string
  supplier: DocumentSupplier
  customer: DocumentCustomer
  meta: {
    quoteNo: string
    /** 이 견적의 이름. 문서 본문엔 안 찍고 **화면 머리글**이 쓴다 — 어느 견적을 보는지 */
    title: string
    issuedOn: string | null
    validUntil: string | null
    currency: string
    /** 유효기간이 지났나 — 인쇄 전에 알아야 한다 */
    expired: boolean
  }
  lines: DocumentLine[]
  totals: DocumentTotals
  /** 고객이 읽는 조건. 비어 있으면 그 줄을 안 그린다 */
  terms: string[]
  /** 고객이 읽는 특기사항 */
  customerNote: string | null
}

// ------------------------------------------------------------
// 입력 — **원가 자리가 없다**
// ------------------------------------------------------------

export interface BuildQuoteDocumentInput {
  quote: {
    quoteNo: string
    title: string
    currency: string
    validUntil: Date | string | null
    /** 견적일. 없으면 만든 날 */
    issuedOn?: Date | string | null
    createdAt: Date | string
    subtotalMinor: bigint | string
    discountMinor: bigint | string
    taxMinor: bigint | string
    totalMinor: bigint | string
    /** 고객에게 나가는 특기사항 */
    notesMd: string | null
    expired?: boolean
  }
  lines: readonly {
    name: string
    descriptionMd?: string | null
    unit?: string | null
    quantity: string | number
    unitPriceMinor: bigint | string
    discountPercent?: string | number
    lineTotalMinor: bigint | string
  }[]
  customer: {
    companyName: string | null
    personName?: string | null
    /** 회사가 없을 때 대신 쓸 이름(딜 이름) */
    fallbackName: string
  }
  supplier: Partial<Record<SupplierField, string | null>>
  /** 오늘 — KST 기준 날짜 문자열을 호출부가 만들어 넘긴다(이 파일은 시간을 모른다) */
  todayKey: string
}

function s(v: bigint | string | number | null | undefined): string {
  if (v === null || v === undefined) return '0'
  return typeof v === 'bigint' ? v.toString() : String(v)
}

function text(v: string | null | undefined): string {
  const t = (v ?? '').trim()
  return t
}

/** 날짜를 `YYYY-MM-DD` 로. 이미 그 모양이면 그대로 둔다 */
function dateKey(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.length >= 10 ? v.slice(0, 10) : v
  const iso = v.toISOString()
  return iso.slice(0, 10)
}

/**
 * 견적 + 고객 + 공급자 → 문서.
 *
 * 빈 값을 «—» 로 채우지 않는다. 비어 있으면 **빈 문자열**로 두고,
 * 그리는 쪽이 그 줄을 통째로 안 그린다 — 문서에 «—» 가 늘어서면
 * 준비가 안 된 문서를 보낸 것처럼 보인다.
 */
export function buildQuoteDocument(input: BuildQuoteDocumentInput): QuoteDocument {
  const currency = (input.quote.currency ?? 'KRW').toUpperCase()
  const validUntil = dateKey(input.quote.validUntil)
  const issuedOn = dateKey(input.quote.issuedOn) ?? dateKey(input.quote.createdAt)

  return {
    documentTitle: QUOTE.documentTitle,
    supplier: {
      name: text(input.supplier.name),
      bizNo: text(input.supplier.bizNo),
      ceo: text(input.supplier.ceo),
      address: text(input.supplier.address),
      bizType: text(input.supplier.bizType),
      bizItem: text(input.supplier.bizItem),
      contact: text(input.supplier.contact),
      terms: text(input.supplier.terms),
    },
    customer: {
      // 회사가 없는 딜도 있다(개인·기관). 그럴 때 「귀중」 앞을 비우면 문서가 아니다
      companyName: text(input.customer.companyName) || text(input.customer.fallbackName),
      personName: text(input.customer.personName) || null,
    },
    meta: {
      quoteNo: input.quote.quoteNo,
      title: input.quote.title,
      issuedOn,
      validUntil,
      currency,
      /*
        **둘 중 하나라도 참이면 지난 것이다.**

        저장된 `expired` 는 «보낸 견적이 기한을 넘겼나»를 본다(markExpired 는 SENT 만 판정한다).
        업무 흐름으로는 맞다 — 안 보낸 초안은 «만료»가 아니다.
        그런데 **문서는 다르다.** 고객이 받는 종이에 「유효기간 2026-01-31」이 찍히는데
        오늘이 8월이면, 상태가 무엇이든 그 문서는 보내면 안 된다.
        `??` 로 저장 판정을 우선하면 초안은 영원히 «만료 아님»이라 경고가 안 뜬다
        (실브라우저에서 잡았다 — 7개월 지난 견적이 아무 표시 없이 그려졌다).

        날짜 비교는 문자열로 충분하다 — YYYY-MM-DD 는 사전순 = 날짜순이고,
        둘 다 KST 로 만들어진 키다.
      */
      expired: (input.quote.expired ?? false)
        || (validUntil !== null && validUntil < input.todayKey),
    },
    lines: input.lines.map((l, i) => ({
      no: i + 1,
      name: l.name,
      spec: text(l.descriptionMd) || null,
      unit: text(l.unit) || null,
      quantity: s(l.quantity),
      unitPriceMinor: s(l.unitPriceMinor),
      discountPercent: s(l.discountPercent ?? 0),
      amountMinor: s(l.lineTotalMinor),
    })),
    totals: {
      subtotalMinor: s(input.quote.subtotalMinor),
      discountMinor: s(input.quote.discountMinor),
      taxMinor: s(input.quote.taxMinor),
      totalMinor: s(input.quote.totalMinor),
      totalInWords: hangulAmount(input.quote.totalMinor, currency),
    },
    // 조건은 공급자 기본값에서 온다. 줄바꿈으로 나눠 한 줄씩 그린다
    terms: text(input.supplier.terms).split('\n').map((t) => t.trim()).filter((t) => t !== ''),
    customerNote: text(input.quote.notesMd) || null,
  }
}

// ------------------------------------------------------------
// 문서가 스스로를 검사한다
// ------------------------------------------------------------

/**
 * 인쇄 전 검사 — **저장본과 문서가 어긋났는지**만 본다.
 *
 * 왜 인쇄 시점인가: 이 문서는 고객에게 나간다. 서버 저장 시점의 검사(I1~I5)를
 * 통과했더라도 그 뒤에 데이터가 손으로 고쳐졌을 수 있다.
 * **나가기 직전이 마지막 기회**다.
 *
 * **항등식이 되는 검사는 안 건다.** 항목 하나를 한 섹션으로 보면 I1 은
 * «lineSum === lineSum» 이 되어 무엇을 넣어도 통과한다 —
 * 그런 가드는 통과해도 아무것도 보증하지 않으면서 «검사했다»는 착각만 준다.
 * 여기서 실제로 어긋날 수 있는 것은 둘뿐이다:
 *
 *   ① 항목 합(할인 후) 과 저장된 «소계 − 할인» 이 다르다 → 표와 합계가 따로 논다
 *   ② «소계 − 할인 + 세액» 과 저장된 총액이 다르다 → 고객이 받는 청구액이 틀린다
 */
export function verifyDocument(doc: QuoteDocument): Violation[] {
  const lineSum = doc.lines.reduce((a, l) => a + BigInt(l.amountMinor), BigInt(0))

  // 저장된 소계는 **할인 전** 금액이다(quote-math.computeTotals).
  // 항목의 amountMinor 는 **할인 후**이므로 비교 대상은 «소계 − 할인» 이다.
  const net = BigInt(doc.totals.subtotalMinor)
  const discount = BigInt(doc.totals.discountMinor)
  const tax = BigInt(doc.totals.taxMinor)
  const gross = BigInt(doc.totals.totalMinor)
  const proposed = net - discount

  return [
    ...checkI2([{ id: '항목', subtotalMinor: lineSum }], proposed),
    ...checkI5({ netMinor: net, proposedNetMinor: proposed, taxMinor: tax, grossMinor: gross }),
  ]
}

/** 문서를 내보내도 되나 — 공급자 정보가 비면 «상호 없는 견적서»가 나간다 */
export function missingSupplierFields(doc: QuoteDocument): SupplierField[] {
  return SUPPLIER_ORDER.filter((f) => doc.supplier[f] === '')
}

export { SUPPLIER_ORDER, SUPPLIER_LABEL, type SupplierField }
