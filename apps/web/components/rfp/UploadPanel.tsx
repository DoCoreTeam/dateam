'use client'

// 첨부 올리기 — **등급을 고르기 전에는 제출이 막힌다.**
//
// 등급에 기본값을 주면 NDA 문서가 공개로 들어오고, 그 뒤 모든 외부 호출이
// 「공개니까 보내도 된다」고 판단한다. 그래서 여기서 사람이 반드시 고른다.

import { useCallback, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_INTAKE, DOC_CLASS_LABEL, DOC_CLASS_HINT, DOC_CLASS_EFFECT } from '@/lib/rfp/terms'
import { DOC_CLASS_ORDER, type DocClass } from '@/lib/rfp/domain/doc-class'
import { MAX_FILE_BYTES, MAX_CASE_BYTES } from '@/lib/rfp/db/limits'

export interface UploadPanelProps {
  onDone?: (caseId: string) => void
}

interface Picked {
  file: File
  error: string | null
}

export default function UploadPanel({ onDone }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [docClass, setDocClass] = useState<DocClass | ''>('')
  const [files, setFiles] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)

  const pick = useCallback((list: FileList | null) => {
    if (!list) return
    const next: Picked[] = []
    let total = files.reduce((n, f) => n + f.file.size, 0)
    for (const file of Array.from(list)) {
      // 크기를 여기서 먼저 본다 — 서버까지 갔다 오면 200MB 를 올리고 나서 거절당한다
      const tooBig = file.size > MAX_FILE_BYTES
      total += file.size
      const overQuota = total > MAX_CASE_BYTES
      next.push({
        file,
        error: tooBig ? RFP_INTAKE.fileTooLarge : overQuota ? RFP_INTAKE.caseQuota : null,
      })
    }
    setFiles((prev) => [...prev, ...next])
  }, [files])

  const remove = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const submit = useCallback(async () => {
    setError(null)
    if (!title.trim()) { setError(RFP_INTAKE.titleRequired); return }
    // 등급을 안 고르면 여기서 멈춘다
    if (!docClass) { setError(RFP_INTAKE.docClassRequired); return }

    setBusy(true)
    try {
      const created = await fetch('/api/rfp/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), docClass }),
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
  }, [title, docClass, files, onDone])

  const canSubmit = Boolean(title.trim()) && Boolean(docClass) && !busy

  return (
    <div className="card">
      {error && <FormErrorBanner message={error} />}

      <div className="field">
        <label className="label" htmlFor="rfp-title">{RFP_INTAKE.titleLabel}</label>
        <input
          id="rfp-title"
          className="input-field"
          value={title}
          placeholder={RFP_INTAKE.titlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <fieldset className="field">
        <legend className="label">{RFP_INTAKE.docClassLabel}</legend>
        {DOC_CLASS_ORDER.map((c) => (
          <label key={c} style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
            <input
              type="radio"
              name="docClass"
              value={c}
              checked={docClass === c}
              onChange={() => setDocClass(c)}
            />
            <span style={{ marginLeft: 'var(--space-2)', fontWeight: 600 }}>{DOC_CLASS_LABEL[c]}</span>
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', marginLeft: 'var(--space-5)' }}>
              {DOC_CLASS_HINT[c]}
            </div>
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', marginLeft: 'var(--space-5)' }}>
              {DOC_CLASS_EFFECT[c]}
            </div>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <span className="label">{RFP_INTAKE.fileLabel}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => pick(e.target.files)}
        />
        <NbButton variant="ghost" onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> {RFP_INTAKE.filePick}
        </NbButton>

        {files.length === 0 && (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_INTAKE.fileNone}</p>
        )}
        <ul>
          {files.map((f, i) => (
            <li key={`${f.file.name}-${i}`}>
              <span>{f.file.name}</span>
              {f.error && <span style={{ color: 'var(--danger)' }}> {f.error}</span>}
              <button type="button" className="btn-ghost" aria-label={RFP_INTAKE.fileNone} onClick={() => remove(i)}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <NbButton onClick={() => void submit()} disabled={!canSubmit}>
        {busy ? RFP_INTAKE.submitting : RFP_INTAKE.submit}
      </NbButton>

      {caseId && (
        <NbButton variant="ghost" href={`/rfp/${caseId}`}>{RFP_INTAKE.goReport}</NbButton>
      )}
    </div>
  )
}
