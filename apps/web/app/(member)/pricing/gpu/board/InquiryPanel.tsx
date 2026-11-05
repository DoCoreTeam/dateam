'use client'

// 문의 창 — 모델 한 줄의 가장 싼 공급사에 묻는다 (lib/gpu/inquiry.ts)
// 메일 쓰기, 전화 걸기, 홈페이지, 글 복사 중 하나를 누르면 그 사실을 GPU 이력(inquiry_sent)에 남긴다
// 메일은 사용자의 메일 앱이 보낸다, 서버는 보내지 않는다

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { fmtKRW } from '@/lib/gpu/format-price'
import { mailtoHref, type Inquiry, type InquiryChannel } from '@/lib/gpu/inquiry'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import SlidePanel from '@/components/ui/SlidePanel'
import ContactLink from '@/components/ui/ContactLink'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import s from './board.module.css'

export const INQUIRY_API = '/api/pricing/gpu/inquiry'
const SUPPLIERS_HREF = '/pricing/gpu/manage?tab=suppliers'
const PANEL_WIDTH_PX = 560

type Note = { text: string; bad?: boolean } | null

/** 담당자가 없을 때 무엇을 하면 되는지 — 회사가 이어졌나, 공급사로 등록됐나, 관리자인가 */
function NoContact({ inquiry, isAdmin }: { inquiry: Inquiry; isAdmin: boolean }) {
  if (inquiry.crm_company_path) {
    return <p className={s.pHint}>{C.inquiryNoContactCrm} <Link href={inquiry.crm_company_path} className={s.basisLink}>{C.inquiryCrmLink}</Link></p>
  }
  if (!inquiry.supplier_id) return <p className={s.pHint}>{C.inquiryNotSupplier}</p>
  if (isAdmin) {
    return <p className={s.pHint}>{C.inquiryNoContactAdmin} <Link href={SUPPLIERS_HREF} className={s.basisLink}>{C.inquirySupplierLink}</Link></p>
  }
  return <p className={s.pHint}>{C.inquiryNoContactMember}</p>
}

function InquiryBody({ inquiry, isAdmin }: { inquiry: Inquiry; isAdmin: boolean }) {
  const [note, setNote] = useState<Note>(null)
  const draft = `${inquiry.subject}\n\n${inquiry.body}`

  async function record(channel: InquiryChannel) {
    try {
      const res = await fetch(INQUIRY_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product_id: inquiry.product_id, vendor: inquiry.vendor, channel }),
      })
      setNote(res.ok ? { text: C.inquiryLogged } : { text: C.inquiryLogFailed, bad: true })
    } catch {
      setNote({ text: C.inquiryLogFailed, bad: true })
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft)
      setNote({ text: C.inquiryCopied })
      await record('copy')
    } catch {
      setNote({ text: C.inquiryCopyFailed, bad: true })
    }
  }

  const price = inquiry.offer.krw == null ? C.unknownUnit : fmtKRW(inquiry.offer.krw)
  return (
    <>
      <p className={s.pSellLine}>{C.inquiryLead(inquiry.model, price)}</p>

      <section className={s.pSection}>
        <h3 className={s.pHeading}>{C.inquiryContacts}</h3>
        {inquiry.contacts.length === 0 ? <NoContact inquiry={inquiry} isAdmin={isAdmin} /> : (
          <ul className={s.iContacts}>
            {inquiry.contacts.map((c, i) => (
              <li key={`${c.name}-${i}`} className={s.iContact}>
                <span className={s.pVendor}>{c.name}{c.title && <span className={s.tag}> {c.title}</span>}</span>
                {/* 번호와 주소는 공용 부품이 그리고(걸기 복사), 누르면 그 길로 문의한 것으로 남긴다 */}
                <span className={s.iReach}>
                  {c.phone && (
                    <span onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) void record('phone') }}>
                      <ContactLink kind="phone" value={c.phone} />
                    </span>
                  )}
                  {c.email && (
                    <>
                      <ContactLink kind="email" value={c.email} />
                      <a className={`${s.action} ${s.actionLead}`} href={mailtoHref(c.email, inquiry.subject, inquiry.body)} onClick={() => void record('mail')}>{C.inquiryMail}</a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(inquiry.website || inquiry.source_url) && (
          <p className={s.pActions}>
            {inquiry.website && (
              <a className={s.action} href={inquiry.website} target="_blank" rel="noopener noreferrer" onClick={() => void record('site')}>{C.inquiryWebsite}</a>
            )}
            {inquiry.source_url && inquiry.source_url !== inquiry.website && (
              <a className={s.action} href={inquiry.source_url} target="_blank" rel="noopener noreferrer" onClick={() => void record('site')}>{C.inquirySource}</a>
            )}
          </p>
        )}
      </section>

      <section>
        <h3 className={s.pHeading}>{C.inquiryDraft}</h3>
        <label className={`${s.pLabel} ${s.iSubject}`}>{C.inquirySubject}
          <input className="input-field" readOnly value={inquiry.subject} />
        </label>
        <textarea className={`input-field ${s.iDraft}`} readOnly rows={10} value={inquiry.body} aria-label={C.inquiryDraft} />
        <div className={s.pActions}>
          <button type="button" className="btn-primary" onClick={() => void copy()}>{C.inquiryCopy}</button>
        </div>
        {note && <p className={note.bad ? s.pError : s.pHint} role="status">{note.text}</p>}
      </section>
    </>
  )
}

export default function InquiryPanel({ productId, isAdmin, onClose }: { productId: string; isAdmin: boolean; onClose: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Inquiry>(`${INQUIRY_API}?product_id=${productId}`, fetcher)
  return (
    <SlidePanel isOpen onClose={onClose} title={data ? C.inquiryTitle(data.vendor) : C.inquire} width={PANEL_WIDTH_PX}>
      {error ? (
        <ErrorState message={error instanceof Error && error.message ? error.message : C.inquiryLoadFailed} onRetry={() => void mutate()} />
      ) : isLoading || !data ? (
        <SkelList rows={4} />
      ) : (
        <InquiryBody inquiry={data} isAdmin={isAdmin} />
      )}
    </SlidePanel>
  )
}
