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
import { Printer, Download, Pencil, FileText, Image as ImageIcon } from 'lucide-react'
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
import QuoteEditorModal, { quoteToDraft, type QuoteDraft } from '@/components/ui/crm/QuoteEditorModal'
import { ACTION } from '@/lib/terms'
import DocSurface from '@/components/ui/doc/DocSurface'
import QuoteSheet from './QuoteSheet'
import { downloadPaperAsPng } from '@/lib/crm/api/paper-image'
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
  /**
   * 편집 초안. 모달은 **딜 id 와 초안**을 받으므로 견적을 한 번 더 읽어야 한다 —
   * 문서 응답은 «인쇄용»이라 편집에 필요한 원본 값(항목 id·버전)을 담지 않는다.
   */
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [draftDealId, setDraftDealId] = useState<string | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  /** 미리보기가 열렸나 — 내보내기는 전부 그 안에서 일어난다 */
  const [preview, setPreview] = useState(false)
  const [imaging, setImaging] = useState(false)

  /**
   * 종이를 이미지로.
   *
   * **왜 화면에서 만드나**: 서버에서 그리려면 브라우저를 하나 더 띄워야 하고(무겁다),
   * 그렇게 만든 그림은 여기 보이는 것과 미묘하게 다르다.
   * 미리보기의 종이를 그대로 찍으면 **보는 것과 받는 것이 같다**.
   */
  const saveImage = useCallback(async () => {
    setImaging(true)
    setExportError(null)
    try {
      const paper = document.querySelector('.doc-paper')
      if (!(paper instanceof HTMLElement)) {
        setExportError('미리보기를 먼저 열어 주세요.')
        return
      }
      await downloadPaperAsPng(paper, `${quoteId}.png`)
    } catch {
      setExportError('이미지를 만들지 못했습니다. 인쇄로 PDF 저장을 대신 써 주세요.')
    } finally {
      setImaging(false)
    }
  }, [quoteId])

  const openEdit = useCallback(async () => {
    setLoadingDraft(true)
    setExportError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`)
      const body = await res.json()
      if (!res.ok) { setExportError(body?.error?.message ?? '견적을 불러오지 못했습니다.'); return }
      setDraftDealId(body.dealId ?? null)
      setDraft(quoteToDraft(body))
    } catch {
      setExportError('견적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoadingDraft(false)
    }
  }, [quoteId])

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
          **문서를 보는 자리에서 바로 고친다.**
          예전엔 견적을 고치려면 딜 상세로 돌아가 그 견적을 찾아 「수정」을 눌러야 했다 —
          문서를 읽다가 틀린 곳을 찾는 것이 정상적인 순서인데, 고칠 길이 그 자리에 없었다
          (사용자 지적: 「여기도 수정버튼을 두고 견적수정 화면으로 들어가야지」).
        */}
        <NbButton variant="ghost" disabled={loadingDraft} onClick={() => void openEdit()}>
          <Pencil size={16} /> {loadingDraft ? progress(ACTION.edit) : ACTION.edit}
        </NbButton>
        {/*
          **내보내기는 미리보기 안에서만 한다**(정책 §문서 내보내기).
          예전엔 이 화면에서 바로 `window.print()` 를 불렀는데, 그러면 **앱 화면이 통째로 찍힌다** —
          사이드바·상단 바·회색 배경까지 고객에게 가는 PDF 에 실렸다(사용자 지적).
          미리보기는 셸 밖의 «종이»라 화면에서 보는 것이 곧 나가는 것이다.
        */}
        <NbButton onClick={() => setPreview(true)}>
          <FileText size={16} /> {QUOTE.openPreview}
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

      <QuoteSheet doc={doc} logo={data.images.logo} />

      {/*
        ── 미리보기 ──────────────────────────────────────────
        엑셀·PDF·이미지가 **전부 여기서** 나간다. 화면에서 보는 종이가 곧 나가는 것이다.
      */}
      {preview && (
        <DocSurface
          title={`${QUOTE.documentTitle} · ${doc.meta.quoteNo}`}
          onClose={() => setPreview(false)}
          actions={
            <>
              <NbButton variant="ghost" disabled={exporting || blocked} onClick={() => void exportCsv()} title={EXPORT_SAFE_NOTE}>
                <Download size={16} /> {exporting ? progress(QUOTE.exportXlsx) : QUOTE.exportXlsx}
              </NbButton>
              <NbButton variant="ghost" disabled={imaging || blocked} onClick={() => void saveImage()}>
                <ImageIcon size={16} /> {imaging ? progress(QUOTE.exportImage) : QUOTE.exportImage}
              </NbButton>
              <NbButton onClick={() => window.print()} title={PRINT_HINT}>
                <Printer size={16} /> {QUOTE.print}
              </NbButton>
            </>
          }
        >
          {/* 오류는 종이 위가 아니라 도구 아래에 — 문서에 우리 사정이 찍히면 안 된다 */}
          <QuoteSheet doc={doc} logo={data.images.logo} surface="paper" />
        </DocSurface>
      )}

      {/* 저장하면 문서를 다시 읽는다 — 고쳤는데 화면이 그대로면 저장이 안 된 줄 안다 */}
      {draft && draftDealId && (
        <QuoteEditorModal
          dealId={draftDealId}
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); void load() }}
        />
      )}
    </div>
  )
}
