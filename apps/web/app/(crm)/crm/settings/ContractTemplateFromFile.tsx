'use client'

// 계약서 파일로 템플릿 만들기 (P0132 I07)
//
// 파일을 올리면 서버가 조항을 나누고 칸 자리를 짚은 **작성 중 템플릿**을 만든다.
// 끝나면 결과(넣은 칸 수, 버린 제안, AI 실패 사유)를 말하고 편집 창을 연다 — 발행은 사람이 확인한 뒤에 한다.

import { useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import WaitProgress from '@/components/ui/WaitProgress'
import { useCanEdit } from '@/lib/crm/ui/can-edit'
import { quoteWaitProgress } from '@/lib/crm/ui/quote-read-progress'
import { ACTION } from '@/lib/terms'
import { CONTRACT_FROM_FILE } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'

export interface FromFileResult {
  template: { id: string; name: string; version: number; currentVersionNo: number | null; businessTypeKey: string | null; isDefault: boolean; draftBody: unknown }
  applied: number
  rejected: number
  ai: { status: 'ok' } | { status: 'failed'; message: string }
  truncated: boolean
  attached: boolean
  sourceFileName: string
}

interface Props {
  onClose: () => void
  onCreated: (result: FromFileResult) => void
}

/** 받은 결과를 사람이 읽을 줄로 — 넣은 것, 못 넣은 것, 못 읽은 것을 다 말한다 */
export function resultLines(r: FromFileResult): string[] {
  const lines: string[] = []
  if (r.ai.status === 'failed') lines.push(CONTRACT_FROM_FILE.aiSkipped(r.ai.message))
  else lines.push(r.applied > 0 ? CONTRACT_FROM_FILE.doneFields(r.applied) : CONTRACT_FROM_FILE.doneNoFields)
  if (r.rejected > 0) lines.push(CONTRACT_FROM_FILE.rejectedCount(r.rejected))
  if (r.truncated) lines.push(CONTRACT_FROM_FILE.truncated)
  if (!r.attached) lines.push(CONTRACT_FROM_FILE.attachFailed)
  return lines
}

export default function ContractTemplateFromFile({ onClose, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = useCanEdit()
  /*
    창구 상한이 180초다. 그동안 한 마디만 하면 사람은 고장으로 읽는다 —
    견적 파일 읽기와 같은 문구와 문턱(quote-read-progress)을 쓴다.
  */
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const start = async () => {
    if (!file || !canEdit) return
    setBusy(true)
    setError(null)
    setElapsedMs(0)
    setStartedAt(Date.now())
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/crm/contract-templates/from-file', { method: 'POST', body: form })
      if (!res.ok) {
        let message: string = CONTRACT_FROM_FILE.failed
        try { message = (await res.json())?.error?.message ?? message } catch { /* 본문 없음 */ }
        setError(message)
        return
      }
      onCreated(await res.json())
    } catch {
      setError(CONTRACT_FROM_FILE.failed)
    } finally {
      setBusy(false)
      setStartedAt(null)
    }
  }

  return (
    <NbModal
      title={CONTRACT_FROM_FILE.title}
      onClose={() => !busy && onClose()}
      maxWidth={560}
      footer={
        <span className={styles.itemActions}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void start()} disabled={!canEdit || busy || !file}>{CONTRACT_FROM_FILE.start}</NbButton>
        </span>
      }
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        <p className={styles.desc}>{CONTRACT_FROM_FILE.intro}</p>
        <label className="label" htmlFor="ct-file">{CONTRACT_FROM_FILE.pick}</label>
        <input
          id="ct-file" type="file" className="input-field" disabled={busy}
          accept=".pdf,.docx,.hwp,.hwpx,.odt,.rtf,.txt,application/pdf"
          onChange={(e) => { setError(null); setFile(e.target.files?.[0] ?? null) }}
        />
        <span className={styles.footNote}>{CONTRACT_FROM_FILE.accept}</span>
        {busy && (() => {
          const w = quoteWaitProgress({ phase: 'reading', elapsedMs, fileName: file?.name ?? '', fileBytes: file?.size ?? 0 })
          return <WaitProgress message={w.message} elapsedLabel={w.elapsedLabel} reassure={w.reassure} />
        })()}
      </div>
    </NbModal>
  )
}
