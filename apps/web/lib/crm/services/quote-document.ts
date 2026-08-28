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
import { pickTitle, readOrgTitle } from './member-title.ts'
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
  const ownerMemberId = quote.ownerId
    ?? (quote as { createdById?: string | null }).createdById
    ?? null
  const recipientId = (quote as { recipientPersonId?: string | null }).recipientPersonId ?? null

  const [supplier, images, owner, terms, recipient] = await Promise.all([
    readQuoteSupplier(db),
    readQuoteImages(db),
    /*
      **`ownerId` 가 비면 «만든 사람»이 담당이다.**
      `ownerId` 는 나중에 담당을 넘길 때 쓰는 칸이라 대부분 비어 있다 —
      그걸 그대로 읽으면 **모든 견적에 담당자가 안 나온다**(실측: 견적 14건 전부 null 이라
      고객에게 나가는 문서에 연락할 사람이 없었다). 기획 결정 3 이 정한 「영업대표 = 견적을 만든
      로그인 사용자」가 곧 `createdById` 다.
    */
    ownerMemberId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmMember.findFirst({
          where: { id: ownerMemberId },
          // hostUserId 로 조직 프로필(직위·직급)을 한 번 더 읽는다 — 사람이 두 번 입력할 일이 아니다
          select: { displayName: true, title: true, phone: true, email: true, hostUserId: true },
        }) as Promise<{ displayName: string; title: string | null; phone: string | null; email: string; hostUserId: string | null } | null>
      : Promise.resolve(null),
    termIds.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmQuoteTerm.findMany({
          where: { id: { in: termIds } },
          select: { id: true, body: true },
        }) as Promise<{ id: string; body: string }[]>
      : Promise.resolve([] as { id: string; body: string }[]),
    /*
      **공급받는 곳의 담당자.** 고르지 않았으면 안 읽는다 —
      「○○ 귀중」만으로도 문서는 성립하고, 억지로 아무나 넣으면 그 사람 앞으로
      간 문서가 되어 버린다(사용자 지시: 「체크를 안하면 안나와도 되고」).
    */
    recipientId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmPerson.findFirst({
          where: { id: recipientId },
          select: { name: true, title: true },
        }) as Promise<{ name: string; title: string | null } | null>
      : Promise.resolve(null),
  ])

  /*
    직함은 **조직에서 온다.** `crm_member.title` 은 손으로 채우는 칸이라 대부분 비어 있고,
    호스트 프로필에는 이미 직위(본부장)·직급(상무)이 들어 있다.
    실패해도 문서는 나가야 한다 — `readOrgTitle` 이 조용히 null 을 준다.
  */
  const ownerOrg = await readOrgTitle(owner?.hostUserId ?? null)

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
      // 특별 할인은 «금액이 왜 이런지»의 근거다 — 이게 빠지면 문서가 기본 할인율을 말하면서
      // 특별가 금액을 인쇄해 서로를 반박한다
      specialDiscountPercent: l.specialDiscountPercent,
      lineTotalMinor: l.lineTotalMinor,
    })),
    customer: {
      companyName: deal.company?.name ?? null,
      // 직책이 있으면 「김도현 교수」처럼 함께 적는다 — 문서에서 사람을 지목하는 자리다
      personName: recipient ? [recipient.name, recipient.title].filter(Boolean).join(' ') : null,
      fallbackName: deal.name,
    },
    supplier,
    // **고른 순서대로** 인쇄한다 — DB 가 준 순서가 아니라 termIds 의 순서다
    selectedTerms: termIds
      .map((id) => terms.find((t) => t.id === id)?.body)
      .filter((b): b is string => Boolean(b)),
    owner: owner
      // 직함은 조직에서 온다 — CRM 이 직접 지정한 것이 있으면 그것이 먼저다(pickTitle)
      ? { name: owner.displayName, title: pickTitle(owner.title, ownerOrg), email: owner.email, phone: owner.phone }
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
