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
import { readQuoteSupplier, readQuoteImages } from './setting.ts'
import {
  buildQuoteDocument, verifyDocument, missingSupplierFields,
  type QuoteDocument,
} from '../domain/quote-document.ts'
import { SUPPLIER_LABEL } from '../../terms/quote.ts'
import { kstDateKey } from '../../datetime/kst.ts'

export interface QuoteDocumentResult {
  document: QuoteDocument
  /** 견적서에 찍히는 이미지(data URI). 없으면 빈 문자열. 직인은 이미지가 아니라 문구다 */
  images: { logo: string }
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

  // 담당자는 **견적을 만든 사람**이다 — 회사 설정의 고정 연락처가 아니다(기획 결정 3)
  // 이 견적이 고른 거래 조건. 하나도 안 골랐으면 설정의 기본 조건으로 떨어진다 —
  // 조건을 등록하기 전에 만든 견적이 갑자기 조건 없는 문서가 되면 안 된다
  const termIds = (quote as { termIds?: string[] }).termIds ?? []
  const [supplier, images, owner, terms] = await Promise.all([
    readQuoteSupplier(db),
    readQuoteImages(db),
    quote.ownerId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmMember.findFirst({
          where: { id: quote.ownerId },
          select: { displayName: true, title: true, phone: true, email: true },
        }) as Promise<{ displayName: string; title: string | null; phone: string | null; email: string } | null>
      : Promise.resolve(null),
    termIds.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmQuoteTerm.findMany({
          where: { id: { in: termIds } },
          select: { id: true, body: true },
        }) as Promise<{ id: string; body: string }[]>
      : Promise.resolve([]),
  ])

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
    // **고른 순서대로** 인쇄한다 — DB 가 준 순서가 아니라 termIds 의 순서다
    selectedTerms: termIds
      .map((id) => terms.find((t) => t.id === id)?.body)
      .filter((b): b is string => Boolean(b)),
    owner: owner
      ? { name: owner.displayName, title: owner.title, email: owner.email, phone: owner.phone }
      : undefined,
    todayKey: kstDateKey(new Date().toISOString()),
  })

  return {
    document,
    images,
    violations: verifyDocument(document).map((v) => ({ code: v.code, message: v.message })),
    missingSupplier: missingSupplierFields(document).map((f) => SUPPLIER_LABEL[f]),
  }
}
