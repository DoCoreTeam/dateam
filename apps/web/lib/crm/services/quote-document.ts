/**
 * 견적서 문서 — 읽어서 조립하고, 검사해서 내보낸다
 *
 * **왜 서비스가 따로 있나**: 문서 조립은 순수 함수(domain/quote-document)지만
 * 그 재료는 세 군데(견적·딜/회사·설정)에 흩어져 있다. 화면마다 세 군데를 모으게 하면
 * 인쇄 화면과 엑셀이 서로 다른 재료로 다른 문서를 만든다.
 *
 * **내보내기는 여기 하나뿐이다.** CSV 도 인쇄도 같은 `QuoteDocument` 를 본다 —
 * 그래서 «화면에는 있는데 파일에는 없는» 항목이 생길 수 없다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { getQuote } from './quote.ts'
import { readQuoteSupplier } from './setting.ts'
import {
  buildQuoteDocument, verifyDocument, missingSupplierFields,
  type QuoteDocument,
} from '../domain/quote-document.ts'
import { QUOTE, SUPPLIER_ORDER, SUPPLIER_LABEL } from '../../terms/quote.ts'
import { kstDateKey } from '../../datetime/kst.ts'
import { minorDigits } from '../../../app/(crm)/crm/deals/amount.ts'

export interface QuoteDocumentResult {
  document: QuoteDocument
  /** 저장본과 어긋난 곳 — 있으면 화면이 «이 문서는 보내면 안 된다»고 말한다 */
  violations: { code: string; message: string }[]
  /** 아직 안 채운 공급자 항목의 **사람이 읽는 이름** */
  missingSupplier: string[]
}

export async function getQuoteDocument(db: CrmDb, quoteId: string): Promise<QuoteDocumentResult> {
  const quote = await getQuote(db, quoteId)

  // 딜에서 고객 이름을 가져온다. 회사가 없는 딜(개인·기관)도 있으므로 딜 이름을 예비로 싣는다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = await (db as any).crmDeal.findFirst({
    where: { id: quote.dealId },
    select: { name: true, company: { select: { name: true } } },
  }) as { name: string; company: { name: string } | null } | null
  if (!deal) throw new CrmError('NOT_FOUND', '견적이 붙은 딜을 찾을 수 없습니다.')

  const supplier = await readQuoteSupplier(db)

  const document = buildQuoteDocument({
    quote: {
      quoteNo: quote.quoteNo,
      title: quote.title,
      currency: quote.currency,
      validUntil: quote.validUntil,
      createdAt: quote.createdAt,
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      taxMinor: quote.taxMinor,
      totalMinor: quote.totalMinor,
      notesMd: quote.notesMd,
      expired: quote.expired,
    },
    // 항목은 **필요한 것만** 옮긴다. 통째로 넘기면 나중에 원가 칼럼이 생겼을 때
    // 아무도 모르게 문서로 흘러 들어간다
    lines: (quote.lines ?? []).map((l) => ({
      name: l.name,
      descriptionMd: l.descriptionMd,
      unit: l.unit,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      discountPercent: l.discountPercent,
      lineTotalMinor: l.lineTotalMinor,
    })),
    customer: {
      companyName: deal.company?.name ?? null,
      personName: null,
      fallbackName: deal.name,
    },
    supplier,
    todayKey: kstDateKey(new Date().toISOString()),
  })

  return {
    document,
    violations: verifyDocument(document).map((v) => ({ code: v.code, message: v.message })),
    missingSupplier: missingSupplierFields(document).map((f) => SUPPLIER_LABEL[f]),
  }
}

// ------------------------------------------------------------
// CSV — 같은 문서를 표로 편다
// ------------------------------------------------------------

/** 엑셀에서 수식으로 실행되지 않게 앞을 막는다(CSV 인젝션) */
function csvCell(v: string): string {
  const s = String(v ?? '')
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** 금액을 계산 가능한 숫자로 — 천단위 구분을 넣으면 엑셀이 문자열로 읽는다 */
function money(minor: string, currency: string): string {
  const digits = minorDigits(currency)
  const n = Number(minor) / 10 ** digits
  if (!Number.isFinite(n) || !Number.isSafeInteger(Number(minor))) return minor
  return String(n)
}

export interface QuoteCsvResult {
  filename: string
  csv: string
}

/**
 * 견적서를 CSV 로.
 *
 * **고객에게 보내는 파일이다.** 그래서 담기는 것은 `QuoteDocument` 가 가진 것뿐이고,
 * 그 타입에는 원가·마진이 애초에 없다 — 여기서 지울 것도 없다.
 */
export function quoteDocumentToCsv(doc: QuoteDocument): QuoteCsvResult {
  const cur = doc.meta.currency
  const rows: string[][] = []

  const head = (label: string, value: string) => { if (value) rows.push([label, value]) }

  rows.push([QUOTE.documentTitle])
  rows.push([])
  head(QUOTE.quoteNo, doc.meta.quoteNo)
  head(QUOTE.issuedOn, doc.meta.issuedOn ?? '')
  head(QUOTE.validUntil, doc.meta.validUntil ?? '')
  head(QUOTE.currency, cur)
  rows.push([])

  rows.push([QUOTE.customer, `${doc.customer.companyName} ${QUOTE.customerHonorific}`])
  if (doc.customer.personName) rows.push(['', doc.customer.personName])
  rows.push([])

  rows.push([QUOTE.supplier])
  for (const f of SUPPLIER_ORDER) head(SUPPLIER_LABEL[f], doc.supplier[f])
  rows.push([])

  rows.push([
    QUOTE.lineNo, QUOTE.lineName, QUOTE.lineSpec, QUOTE.lineUnit,
    QUOTE.lineQuantity, QUOTE.lineUnitPrice, `${QUOTE.lineDiscount}(%)`, QUOTE.lineAmount,
  ])
  for (const l of doc.lines) {
    rows.push([
      String(l.no), l.name, l.spec ?? '', l.unit ?? '',
      l.quantity, money(l.unitPriceMinor, cur), l.discountPercent, money(l.amountMinor, cur),
    ])
  }
  rows.push([])

  rows.push([QUOTE.subtotal, money(doc.totals.subtotalMinor, cur)])
  rows.push([QUOTE.discount, money(doc.totals.discountMinor, cur)])
  rows.push([QUOTE.tax, money(doc.totals.taxMinor, cur)])
  rows.push([QUOTE.total, money(doc.totals.totalMinor, cur)])
  if (doc.totals.totalInWords) rows.push([QUOTE.totalInWords, doc.totals.totalInWords])

  if (doc.terms.length > 0) {
    rows.push([])
    rows.push([QUOTE.terms])
    for (const t of doc.terms) rows.push(['', t])
  }
  if (doc.customerNote) {
    rows.push([])
    rows.push([QUOTE.customerNote, doc.customerNote])
  }

  // 한글이 깨지지 않게 BOM — 엑셀은 이게 없으면 UTF-8 을 못 알아본다
  const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\n')
  return { filename: `${doc.meta.quoteNo}_${QUOTE.documentTitle}.csv`, csv }
}
