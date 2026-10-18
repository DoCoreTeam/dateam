'use client'

// 미리보기와 내보내기 (P0132 I12a)
//
// 미리보기는 내보내기 창구의 HTML 을 그대로 그린다 — 파일로 나갈 종이와 화면 종이가
// 다른 코드에서 나오면 「미리보기는 맞는데 PDF 는 틀리다」가 된다.
// 내려받기는 같은 창구에 형식만 바꿔 부른다. 실패는 이 창 안에서 말한다.

import { useEffect, useState } from 'react'
import { FileDown, FileText } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { failedTo, progress } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_SCREEN } from '@/lib/terms/contract-doc'
import { contractApi, fetchPaperHtml, type Outcome } from './contract-api'
import ContractPaperFrame, { exportedPaperHtml } from './ContractPaperFrame'
import styles from './contract-view.module.css'

interface Props {
  contractId: string
  contractNo: string
  versionNo: number
  onClose: () => void
}

type Load = { kind: 'loading' } | { kind: 'denied' } | { kind: 'error'; message: string } | { kind: 'ok'; html: string }

export default function ContractPreview({ contractId, contractNo, versionNo, onClose }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [seq, setSeq] = useState(0)
  const [downloading, setDownloading] = useState<'pdf' | 'docx' | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const title = CONTRACT_SCREEN.paperTitle(contractNo, versionNo)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    void fetchPaperHtml(contractApi.exportUrl(contractId, 'html', versionNo), failedTo(CONTRACT_SCREEN.preview, '열지'))
      .then((out: Outcome<string>) => {
        if (!alive) return
        if (out.ok) setState({ kind: 'ok', html: exportedPaperHtml(out.body) })
        else if (out.status === 403) setState({ kind: 'denied' })
        else setState({ kind: 'error', message: out.message })
      })
    return () => { alive = false }
  }, [contractId, versionNo, seq])

  async function download(format: 'pdf' | 'docx') {
    if (downloading) return
    setDownloading(format)
    setDownloadError(null)
    const fail = failedTo(CONTRACT_DOC.entity, '내려받지')
    try {
      const res = await fetch(contractApi.exportUrl(contractId, format, versionNo))
      if (!res.ok) {
        const out = await fetchPaperHtml(contractApi.exportUrl(contractId, format, versionNo), fail)
        setDownloadError(out.ok ? fail : out.message)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${contractNo}-v${versionNo}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError(fail)
    } finally {
      setDownloading(null)
    }
  }

  const ready = state.kind === 'ok'
  return (
    <NbModal
      title={title}
      onClose={onClose}
      maxWidth={960}
      footer={(
        <div className={styles.previewFoot}>
          {downloadError && <span className={styles.danger} role="alert">{downloadError}</span>}
          <NbButton variant="ghost" disabled={!ready || !!downloading} onClick={() => void download('docx')}>
            <FileText size={16} aria-hidden /> {downloading === 'docx' ? progress(CONTRACT_SCREEN.exportDocx) : CONTRACT_SCREEN.exportDocx}
          </NbButton>
          <NbButton disabled={!ready || !!downloading} onClick={() => void download('pdf')}>
            <FileDown size={16} aria-hidden /> {downloading === 'pdf' ? progress(CONTRACT_SCREEN.exportPdf) : CONTRACT_SCREEN.exportPdf}
          </NbButton>
        </div>
      )}
    >
      {state.kind === 'loading' && <AXDotLoader />}
      {state.kind === 'denied' && <EmptyState title={CONTRACT_SCREEN.previewDenied} />}
      {state.kind === 'error' && <ErrorState message={state.message} onRetry={() => setSeq((n) => n + 1)} />}
      {state.kind === 'ok' && <ContractPaperFrame html={state.html} title={title} tall />}
    </NbModal>
  )
}
