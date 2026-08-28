'use client'

// 견적서 — 고객에게 나가는 문서 그대로
//
// **왜 별도 화면인가**: 편집 모달은 «우리가 숫자를 맞추는 자리»이고
// 이 화면은 «고객이 받는 것»이다. 둘을 한 화면에 두면 영업은 편집 화면을 캡처해
// 보내게 되고, 그러면 사이드바와 내부 메모가 함께 찍힌다(실제로 그랬다).
//
// **문서는 서버가 조립한다.** 화면은 그리기만 한다 — 인쇄본과 엑셀이
// 같은 `QuoteDocument` 를 보므로 둘이 다른 말을 할 수 없다.

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Printer, Download } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import { readApiError, describeFetchFailure } from '@/lib/crm/api/read-error'
import { downloadFromApi } from '@/lib/crm/api/download'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  ENTITY,
  failedTo,
  progress,
  QUOTE,
  SUPPLIER_ORDER,
  SUPPLIER_LABEL,
  SUPPLIER_SETUP_HINT,
  EXPORT_SAFE_NOTE,
  EXPORT_BLOCKED_NOTE,
  PRINT_HINT,
  expiredNote,
} from '@/lib/terms'
import type { QuoteDocument } from '@/lib/crm/domain/quote-document'
import styles from './quote-document.module.css'

interface DocumentResponse {
  document: QuoteDocument
  images: { logo: string }
  violations: { code: string; message: string }[]
  missingSupplier: string[]
}

export default function QuoteDocumentView({ quoteId }: { quoteId: string }) {
  const [data, setData] = useState<DocumentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 내려받기 실패는 **이 화면 안에서** 말한다. 페이지를 떠나 보내면 JSON 이 화면을 덮는다
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}/document`)
      const body = await res.json()
      if (!res.ok) { setError(readApiError(body, failedTo(QUOTE.documentTitle, '불러오지'))); return }
      setData(body as DocumentResponse)
    } catch {
      // 서버가 응답조차 못 한 것 — 「잠시 후 다시」와는 다른 상황이다
      setError(describeFetchFailure(QUOTE.documentTitle))
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => { void load() }, [load])

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    const fail = failedTo(QUOTE.documentTitle, '내려받지')
    const out = await downloadFromApi(
      `/api/crm/quotes/${quoteId}/document?format=xlsx`,
      `${quoteId}.xlsx`,
      fail,
    )
    if (!out.ok) setExportError(out.message ?? fail)
    setExporting(false)
  }

  if (loading && !data) return <div className="page-inner"><AXDotLoader /></div>
  if (error) return <div className="page-inner"><ErrorState message={error} onRetry={() => void load()} /></div>
  if (!data) return null

  const doc = data.document
  const cur = doc.meta.currency
  const money = (minor: string) => formatAmount(minor, cur) ?? '0'
  const filled = SUPPLIER_ORDER.filter((f) => doc.supplier[f] !== '')
  const blocked = data.violations.length > 0

  return (
    <div className="page-inner">
      {/*
        화면 장치는 종이에 안 찍힌다. 머리글까지 찍히면 「견적서」가 두 번 나온다 —
        페이지 제목 한 번, 문서 제목 한 번.
      */}
      <div className={styles.screenOnly}>
        {/*
          머리글은 **어느 견적을 보는지**만 말한다.
          건명은 문서 안에 이미 있고(공급받는자 칸), 「원가·마진은 안 담긴다」는
          우리 내부 사정이라 문서를 보는 자리에 설명할 말이 아니다 —
          그건 파일을 내보내는 순간에 필요한 말이라 그 버튼으로 옮겼다.
        */}
        <PageHeader
          title={doc.meta.quoteNo}
          back={{ href: '/crm/quotes', label: ENTITY.quote.label }}
        />
      </div>

      <div className={styles.toolbar}>
        {/*
          어긋난 문서는 **누르기 전에** 막는다. 서버도 막지만(409), 눌러 보고 알게 하면
          같은 오류를 두 자리에서 읽게 된다 — 위반 배너와 실패 배너가 같은 문장을 반복한다.
          이유는 이미 위 배너에 있으므로 여기서는 못 누르는 것으로 충분하다.
        */}
        <NbButton variant="ghost" disabled={exporting || blocked} onClick={() => void exportCsv()} title={EXPORT_SAFE_NOTE}>
          <Download size={16} /> {exporting ? progress(QUOTE.exportXlsx) : QUOTE.exportXlsx}
        </NbButton>
        <NbButton onClick={() => window.print()} title={PRINT_HINT}>
          <Printer size={16} /> {QUOTE.print}
        </NbButton>
      </div>

      {/*
        어긋난 문서는 보내면 안 된다. 화면에서 지나칠 수는 있지만(무엇이 틀렸는지 봐야 하니까)
        파일로는 나가지 않는다 — 서버가 409 로 막는다.
      */}
      <div className={styles.screenOnly}>
      {exportError && <div className={styles.danger}>{exportError}</div>}
      {data.violations.length > 0 && (
        <div className={styles.danger}>
          {data.violations.map((v) => v.message).join('\n')}
          {'\n'}{EXPORT_BLOCKED_NOTE}
        </div>
      )}

      {doc.meta.expired && doc.meta.validUntil && (
        <div className={styles.warn}>{expiredNote(doc.meta.validUntil)}</div>
      )}

      {data.missingSupplier.length > 0 && (
        <div className={styles.warn}>
          {SUPPLIER_SETUP_HINT}
          {' '}
          {`아직 비어 있는 항목: ${data.missingSupplier.join(' · ')}`}
        </div>
      )}
      </div>

      <article className={`card ${styles.sheet}`}>
        {/*
          상단 — 로고(좌)와 문서 메타(우)가 마주 본다.
          로고만 왼쪽에 두면 오른쪽이 비어 문서가 한쪽으로 쏠려 보인다.
        */}
        <header className={styles.topBar}>
          {data.images.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.logo} src={data.images.logo} alt={doc.supplier.name || QUOTE.logo} />
          ) : (
            <span />
          )}

          <dl className={styles.metaList}>
            <dt>{QUOTE.quoteNo}</dt><dd>{doc.meta.quoteNo}</dd>
            {doc.meta.issuedOn && (<><dt>{QUOTE.issuedOn}</dt><dd>{doc.meta.issuedOn}</dd></>)}
            {doc.meta.validUntil && (<><dt>{QUOTE.validUntil}</dt><dd>{doc.meta.validUntil}</dd></>)}
          </dl>
        </header>

        <h2 className={styles.docTitle}>{QUOTE.documentTitle}</h2>

        {/*
          두 당사자 — **같은 구조의 박스**다. 라벨 열 폭이 같아 값의 시작점이 나란하고,
          박스 높이도 맞춰 한쪽만 길어 보이지 않는다(세금계산서가 그렇게 생겼다).
        */}
        <div className={styles.parties}>
          <section className={styles.party}>
            <p className={styles.partyTitle}>{QUOTE.customer}</p>
            <p className={styles.partyName}>
              {doc.customer.companyName} {QUOTE.customerHonorific}
            </p>
            <dl className={styles.partyRows}>
              {doc.customer.personName && (
                <>
                  <dt>{QUOTE.supplierContact}</dt>
                  <dd>{doc.customer.personName}</dd>
                </>
              )}
              {/*
                무엇에 대한 견적인지 — 고객도 알아야 하는 정보다.
                이 칸이 비어 있으면 왼쪽 박스가 텅 비어 문서가 한쪽으로 기울어 보인다.
              */}
              <dt>{QUOTE.subject}</dt>
              <dd>{doc.meta.title}</dd>
            </dl>
          </section>

          <section className={styles.party}>
            <p className={styles.partyTitle}>{QUOTE.supplier}</p>
            {filled.length === 0 ? (
              /* 「—」 로 채우지 않는다. 비었으면 비었다고 말한다 */
              <p className={styles.spec}>{QUOTE.supplierMissing}</p>
            ) : (
              <>
                <p className={styles.partyName}>{doc.supplier.name}</p>
                <dl className={styles.partyRows}>
                  {filled.filter((f) => f !== 'name').map((f) => (
                    <Fragment key={f}>
                      <dt>{SUPPLIER_LABEL[f]}</dt>
                      <dd>{doc.supplier[f]}</dd>
                    </Fragment>
                  ))}
                </dl>
              </>
            )}
            {/*
              날인 자리 — 도장 이미지 대신 문구.
              전자로 보내는 문서에 도장을 박으면 받은 사람이 오려내 다른 문서에 쓸 수 있다.
            */}
            <span className={styles.sealOmitted}>{QUOTE.sealOmitted}</span>
          </section>
        </div>

        {doc.lines.length === 0 ? (
          <EmptyState title={QUOTE.noLines} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              {/* 열 폭을 여기서 정한다 — 내용이 정하게 두면 행마다 열이 흔들린다 */}
              <colgroup>
                <col style={{ width: '3rem' }} />
                <col />
                <col style={{ width: '3.5rem' }} />
                <col style={{ width: '4rem' }} />
                <col style={{ width: '8rem' }} />
                <col style={{ width: '4rem' }} />
                {/* 합계(굵고 큰 글씨)가 들어갈 칸이라 항목 금액보다 넉넉해야 한다 */}
                <col style={{ width: '11.5rem' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={styles.center} scope="col">{QUOTE.lineNo}</th>
                  <th className={styles.left} scope="col">{QUOTE.lineName}</th>
                  <th className={styles.center} scope="col">{QUOTE.lineUnit}</th>
                  <th className={styles.num} scope="col">{QUOTE.lineQuantity}</th>
                  <th className={styles.num} scope="col">{QUOTE.lineUnitPrice}</th>
                  <th className={styles.num} scope="col">{QUOTE.lineDiscount}</th>
                  <th className={styles.num} scope="col">{QUOTE.lineAmount}</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.no}>
                    <td className={styles.center}>{l.no}</td>
                    <td>
                      <div className={styles.lineName}>{l.name}</div>
                      {l.spec && <div className={styles.spec}>{l.spec}</div>}
                    </td>
                    <td className={styles.center}>{l.unit ?? ''}</td>
                    <td className={styles.num}>{Number(l.quantity).toLocaleString('ko-KR')}</td>
                    <td className={styles.num}>{money(l.unitPriceMinor)}</td>
                    <td className={styles.num}>{l.discountPercent === '0' ? '' : `${l.discountPercent}%`}</td>
                    <td className={styles.num}>{money(l.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
              {/*
                합계는 **같은 표 안**이다. 밖에 두면 열 경계와 어긋나
                금액이 위아래로 안 맞는다(앞 판이 그랬다).
              */}
              <tfoot>
                {/* 라벨은 **두 칸에 걸친다** — 한 칸(할인 열)이면 「합계 금액」이 두 줄로 깨진다 */}
                <tr className={styles.firstTotal}>
                  <td colSpan={4} />
                  <td className={styles.totalLabel} colSpan={2}>{QUOTE.subtotal}</td>
                  <td className={styles.num}>{money(doc.totals.subtotalMinor)}</td>
                </tr>
                <tr>
                  <td colSpan={4} />
                  <td className={styles.totalLabel} colSpan={2}>{QUOTE.discount}</td>
                  <td className={styles.num}>
                    {doc.totals.discountMinor !== '0' && '− '}{money(doc.totals.discountMinor)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} />
                  <td className={styles.totalLabel} colSpan={2}>{QUOTE.tax}</td>
                  <td className={styles.num}>{money(doc.totals.taxMinor)}</td>
                </tr>
                <tr className={styles.grand}>
                  <td colSpan={4} />
                  <td className={styles.totalLabel} colSpan={2}>{QUOTE.total}</td>
                  <td className={styles.num}>{money(doc.totals.totalMinor)}</td>
                </tr>
                {/* 한글 금액은 위조 방지가 목적이라 총액 바로 아래 붙는다 */}
                {doc.totals.totalInWords && (
                  <tr className={styles.inWords}>
                    <td colSpan={3} />
                    <td className={styles.num} colSpan={4}>{doc.totals.totalInWords}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {doc.terms.length > 0 && (
          <section className={styles.terms}>
            <p className={styles.termsTitle}>{QUOTE.terms}</p>
            <ul className={styles.termsList}>
              {doc.terms.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </section>
        )}

        {doc.customerNote && (
          <section className={styles.terms}>
            <p className={styles.termsTitle}>{QUOTE.customerNote}</p>
            <p className={styles.note}>{doc.customerNote}</p>
          </section>
        )}
      </article>
    </div>
  )
}
