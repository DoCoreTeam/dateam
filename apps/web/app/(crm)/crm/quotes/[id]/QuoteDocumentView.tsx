'use client'

// 견적서 — 고객에게 나가는 문서 그대로
//
// **왜 별도 화면인가**: 편집 모달은 «우리가 숫자를 맞추는 자리»이고
// 이 화면은 «고객이 받는 것»이다. 둘을 한 화면에 두면 영업은 편집 화면을 캡처해
// 보내게 되고, 그러면 사이드바와 내부 메모가 함께 찍힌다(실제로 그랬다).
//
// **문서는 서버가 조립한다.** 화면은 그리기만 한다 — 인쇄본과 엑셀이
// 같은 `QuoteDocument` 를 보므로 둘이 다른 말을 할 수 없다.

import { useCallback, useEffect, useState } from 'react'
import { Printer, Download } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import { readApiError } from '@/lib/crm/api/read-error'
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
  expiredNote,
} from '@/lib/terms'
import type { QuoteDocument } from '@/lib/crm/domain/quote-document'
import styles from './quote-document.module.css'

interface DocumentResponse {
  document: QuoteDocument
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
      setError(failedTo(QUOTE.documentTitle, '불러오지'))
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
      `/api/crm/quotes/${quoteId}/document?format=csv`,
      `${quoteId}.csv`,
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
        <PageHeader
          title={doc.meta.quoteNo}
          back={{ href: '/crm/quotes', label: ENTITY.quote.label }}
          description={`${doc.meta.title} · ${EXPORT_SAFE_NOTE}`}
        />
      </div>

      <div className={styles.toolbar}>
        {/*
          어긋난 문서는 **누르기 전에** 막는다. 서버도 막지만(409), 눌러 보고 알게 하면
          같은 오류를 두 자리에서 읽게 된다 — 위반 배너와 실패 배너가 같은 문장을 반복한다.
          이유는 이미 위 배너에 있으므로 여기서는 못 누르는 것으로 충분하다.
        */}
        <NbButton variant="ghost" disabled={exporting || blocked} onClick={() => void exportCsv()}>
          <Download size={16} /> {exporting ? progress(QUOTE.exportCsv) : QUOTE.exportCsv}
        </NbButton>
        <NbButton onClick={() => window.print()}>
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
        <h2 className={styles.docTitle}>{QUOTE.documentTitle}</h2>

        <div className={styles.parties}>
          <section>
            <p className={styles.partyTitle}>{QUOTE.customer}</p>
            <p className={styles.customerName}>
              {doc.customer.companyName} {QUOTE.customerHonorific}
            </p>
            {doc.customer.personName && <p className={styles.spec}>{doc.customer.personName}</p>}
          </section>

          <section>
            <p className={styles.partyTitle}>{QUOTE.supplier}</p>
            {filled.length === 0 ? (
              /* 「—」 로 채우지 않는다. 비었으면 비었다고 말하고 어디로 가면 되는지 알려 준다 */
              <p className={styles.spec}>{QUOTE.supplierMissing}</p>
            ) : (
              <dl className={styles.supplierRows}>
                {filled.map((f) => (
                  <div className={styles.supplierRow} key={f}>
                    <dt>{SUPPLIER_LABEL[f]}</dt>
                    <dd>{doc.supplier[f]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <div className={styles.meta}>
          <span>{QUOTE.quoteNo} <b>{doc.meta.quoteNo}</b></span>
          {doc.meta.issuedOn && <span>{QUOTE.issuedOn} <b>{doc.meta.issuedOn}</b></span>}
          {doc.meta.validUntil && <span>{QUOTE.validUntil} <b>{doc.meta.validUntil}</b></span>}
          <span>{QUOTE.currency} <b>{cur}</b></span>
        </div>

        {doc.lines.length === 0 ? (
          <EmptyState title={QUOTE.noLines} />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.num}>{QUOTE.lineNo}</th>
                    <th>{QUOTE.lineName}</th>
                    <th>{QUOTE.lineUnit}</th>
                    <th className={styles.num}>{QUOTE.lineQuantity}</th>
                    <th className={styles.num}>{QUOTE.lineUnitPrice}</th>
                    <th className={styles.num}>{QUOTE.lineDiscount}</th>
                    <th className={styles.num}>{QUOTE.lineAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.no}>
                      <td className={styles.num}>{l.no}</td>
                      <td>
                        {l.name}
                        {l.spec && <div className={styles.spec}>{l.spec}</div>}
                      </td>
                      <td>{l.unit ?? ''}</td>
                      <td className={styles.num}>{l.quantity}</td>
                      <td className={styles.num}>{money(l.unitPriceMinor)}</td>
                      <td className={styles.num}>{l.discountPercent === '0' ? '' : `${l.discountPercent}%`}</td>
                      <td className={styles.num}>{money(l.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.totals}>
              <div className={styles.totalRow}>
                <span>{QUOTE.subtotal}</span><span>{money(doc.totals.subtotalMinor)}</span>
              </div>
              <div className={styles.totalRow}>
                <span>{QUOTE.discount}</span>
                <span>
                  {doc.totals.discountMinor !== '0' && '− '}{money(doc.totals.discountMinor)}
                </span>
              </div>
              <div className={styles.totalRow}>
                <span>{QUOTE.tax}</span><span>{money(doc.totals.taxMinor)}</span>
              </div>
              <div className={styles.grandRow}>
                <span>{QUOTE.total}</span><span>{money(doc.totals.totalMinor)}</span>
              </div>
              {/* 한글 금액은 위조 방지가 목적이라 총액 바로 아래 붙는다 */}
              {doc.totals.totalInWords && (
                <p className={styles.inWords}>{doc.totals.totalInWords}</p>
              )}
            </div>
          </>
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
