'use client'

// 첨부 올리기 — **파일과 등급 둘뿐이다.**
//
// 사업명은 묻지 않는다. 공고문 안에 있는 것을 사람에게 타이핑시키는 것은
// 시스템이 곧 알아낼 것을 두 번 시키는 것이다. 파일 이름으로 임시 이름을 만들고,
// 분석이 진짜 사업명을 찾으면 그때 대신한다.
//
// **등급을 고르기 전에는 제출이 막힌다.**
//
// 등급에 기본값을 주면 NDA 문서가 공개로 들어오고, 그 뒤 모든 외부 호출이
// 「공개니까 보내도 된다」고 판단한다. 그래서 여기서 사람이 반드시 고른다.
//
// ## 배치
//
// 두 덩어리다 — 무엇을 읽나(파일) / 어디까지 보낼 수 있나(등급).
// 예전엔 사업명까지 셋을 한 카드에 이어 붙여서 어디까지가 한 질문인지 안 보였다.

import { useCallback, useRef, useState } from 'react'
import { Upload, X, FileText } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_INTAKE, DOC_CLASS_LABEL, DOC_CLASS_HINT, DOC_CLASS_EFFECT } from '@/lib/rfp/terms'
import { DOC_CLASS_ORDER, type DocClass } from '@/lib/rfp/domain/doc-class'
import { MAX_FILE_BYTES, MAX_CASE_BYTES } from '@/lib/rfp/db/limits'
import { provisionalTitle } from '@/lib/rfp/db/cases'
import styles from '@/app/(rfp)/rfp.module.css'

export interface UploadPanelProps {
  onDone?: (caseId: string) => void
}

interface Picked {
  file: File
  error: string | null
}

/** 사람이 읽는 크기 */
function humanSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

export default function UploadPanel({ onDone }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [docClass, setDocClass] = useState<DocClass | ''>('')
  const [files, setFiles] = useState<Picked[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)

  const pick = useCallback((list: FileList | null) => {
    if (!list) return
    setFiles((prev) => {
      let total = prev.reduce((n, f) => n + f.file.size, 0)
      const next: Picked[] = []
      for (const file of Array.from(list)) {
        // 크기를 여기서 먼저 본다 — 서버까지 갔다 오면 200MB 를 올리고 나서 거절당한다
        const tooBig = file.size > MAX_FILE_BYTES
        total += file.size
        next.push({
          file,
          error: tooBig ? RFP_INTAKE.fileTooLarge : total > MAX_CASE_BYTES ? RFP_INTAKE.caseQuota : null,
        })
      }
      return [...prev, ...next]
    })
  }, [])

  const remove = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const submit = useCallback(async () => {
    setError(null)
    // 등급을 안 고르면 여기서 멈춘다
    if (!docClass) { setError(RFP_INTAKE.docClassRequired); return }

    setBusy(true)
    try {
      const created = await fetch('/api/rfp/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 이름은 첫 파일에서 딴 임시값이다. 분석이 사업명을 찾으면 대신한다
        body: JSON.stringify({ title: provisionalTitle(files.find((f) => !f.error)?.file.name), docClass }),
      })
      const body = await created.json()
      if (!created.ok) { setError(RFP_INTAKE.failed); return }

      const id = body.case?.id as string
      setCaseId(id)

      for (const f of files) {
        if (f.error) continue
        const form = new FormData()
        form.append('file', f.file)
        await fetch(`/api/rfp/cases/${id}/files`, { method: 'POST', body: form })
      }

      await fetch(`/api/rfp/cases/${id}/analyze`, { method: 'POST' })
      onDone?.(id)
    } catch {
      setError(RFP_INTAKE.failed)
    } finally {
      setBusy(false)
    }
  }, [docClass, files, onDone])

  const usable = files.filter((f) => !f.error).length
  const canSubmit = Boolean(docClass) && usable > 0 && !busy

  return (
    <div className={styles.stack}>
      {error && <FormErrorBanner message={error} />}

      {/* ① 어디까지 보낼 수 있나 — 고르지 않으면 못 넘어간다 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{RFP_INTAKE.docClassLabel}</span>
          <span className={styles.sectionDesc}>{RFP_INTAKE.docClassWhy}</span>
        </div>

        <div className={styles.choiceList}>
          {DOC_CLASS_ORDER.map((c) => (
            <label key={c} className={styles.choice} data-selected={docClass === c}>
              <input
                type="radio"
                name="docClass"
                value={c}
                checked={docClass === c}
                onChange={() => setDocClass(c)}
              />
              <span className={styles.choiceTitle}>{DOC_CLASS_LABEL[c]}</span>
              <span className={styles.choiceHint}>{DOC_CLASS_HINT[c]}</span>
              <span className={styles.choiceHint}>{DOC_CLASS_EFFECT[c]}</span>
            </label>
          ))}
        </div>
      </section>

      {/* ② 무엇을 읽나 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <div className={styles.between}>
            <span className={styles.sectionTitle}>{RFP_INTAKE.fileLabel}</span>
            {files.length > 0 && <NbBadge status="note">{usable} / {files.length}</NbBadge>}
          </div>
          <span className={styles.sectionDesc}>{RFP_INTAKE.fileHint}</span>
          {/* 이름을 왜 안 묻는지 화면이 말한다 — 안 말하면 «칸이 빠졌나»로 읽힌다 */}
          <span className={styles.sectionDesc}>{RFP_INTAKE.titleFromDoc}</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => pick(e.target.files)}
        />

        <div
          className={styles.dropzone}
          data-active={dragging}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files) }}
        >
          <Upload size={20} />
          <span className={styles.sectionDesc}>{RFP_INTAKE.dropHere}</span>
          <NbButton variant="ghost" onClick={() => inputRef.current?.click()}>
            {RFP_INTAKE.filePick}
          </NbButton>
        </div>

        {files.length > 0 && (
          <div className={styles.fileList}>
            {files.map((f, i) => (
              <div key={`${f.file.name}-${i}`} className={styles.fileItem}>
                <span className={styles.row}>
                  <FileText size={14} />
                  <span>{f.file.name}</span>
                  <span className={styles.sectionDesc}>{humanSize(f.file.size)}</span>
                  {f.error && <NbBadge status="blocker">{f.error}</NbBadge>}
                </span>
                <NbButton variant="ghost" onClick={() => remove(i)} title={RFP_INTAKE.removeFile}>
                  <X size={12} />
                </NbButton>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className={styles.actions}>
        <NbButton onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? RFP_INTAKE.submitting : RFP_INTAKE.submit}
        </NbButton>
        {caseId && (
          <NbButton variant="ghost" href={`/rfp/${caseId}`}>{RFP_INTAKE.goReport}</NbButton>
        )}
      </div>
    </div>
  )
}
