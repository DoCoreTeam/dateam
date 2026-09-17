'use client'

// 첨부 올리기 — **등급과 「무엇을 읽나」 둘뿐이다.**
//
// 「무엇을 읽나」에 길이 둘이다. 파일을 올리거나, **공고 링크를 붙여넣거나.**
// 사람이 공고를 볼 때 손에 쥐고 있는 것은 주소창의 주소다. 첨부를 하나씩 내려받아
// 다시 올리게 하는 것은 시스템이 할 수 있는 일을 사람에게 시키는 것이다.
//
// 링크는 **가져와 보여 준 다음에** 시작한다. 바로 만들면 첨부 0건짜리 케이스가 생기고
// 사용자는 지울 수도 없는 빈 리포트를 떠안는다(실측 2026-09-10: 「리포트가 없다」).
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
import { Upload, X, FileText, Link2, ExternalLink } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import {
  RFP_INTAKE, DOC_CLASS_LABEL, DOC_CLASS_HINT, DOC_CLASS_EFFECT, rfpNoticeReasonText,
} from '@/lib/rfp/terms'
import type { NoticePreview } from '@/lib/rfp/intake/notice-preview'
import { isEnterKey } from '@/lib/ui/ime'
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

/**
 * 링크로 케이스를 만든다 — 첨부는 서버가 받아 온다.
 *
 * 파일을 이어 올릴 참이면 분석을 서버에서 걸지 않게 한다. 지금 걸면 뒤에 올라온
 * 파일이 빠진 채로 읽힌다.
 */
async function createFromLink(url: string, docClass: DocClass, moreFiles: boolean): Promise<string | null> {
  const res = await fetch('/api/rfp/cases/from-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, docClass, analyze: !moreFiles }),
  })
  const body = await res.json()
  return res.ok ? (body.case?.id as string) ?? null : null
}

/** 파일만 올리는 길 — 이름은 첫 파일에서 딴 임시값이다. 분석이 사업명을 찾으면 대신한다 */
async function createFromFiles(files: readonly Picked[], docClass: DocClass): Promise<string | null> {
  const res = await fetch('/api/rfp/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: provisionalTitle(files.find((f) => !f.error)?.file.name), docClass }),
  })
  const body = await res.json()
  return res.ok ? (body.case?.id as string) ?? null : null
}

export default function UploadPanel({ onDone }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [docClass, setDocClass] = useState<DocClass | ''>('')
  const [files, setFiles] = useState<Picked[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [linking, setLinking] = useState(false)
  const [notice, setNotice] = useState<NoticePreview | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

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

  /**
   * 링크에 무엇이 들어 있는지 **먼저 본다.**
   *
   * 여기서는 아무것도 저장하지 않는다. 사용자가 보고 나서 시작한다.
   */
  const fetchNotice = useCallback(async () => {
    setLinkError(null)
    setNotice(null)
    setLinking(true)
    try {
      const res = await fetch('/api/rfp/intake/notice-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: link }),
      })
      const body = await res.json()
      if (!res.ok) { setLinkError(rfpNoticeReasonText(body.error, body.fallback)); return }
      setNotice(body.preview as NoticePreview)
    } catch {
      setLinkError(rfpNoticeReasonText('fetch_failed'))
    } finally {
      setLinking(false)
    }
  }, [link])

  const clearNotice = useCallback(() => {
    setNotice(null)
    setLinkError(null)
    setLink('')
  }, [])

  const usable = files.filter((f) => !f.error).length

  const submit = useCallback(async () => {
    setError(null)
    // 등급을 안 고르면 여기서 멈춘다
    if (!docClass) { setError(RFP_INTAKE.docClassRequired); return }

    setBusy(true)
    try {
      // 링크로 왔으면 첨부는 서버가 받아 온다. 파일도 골랐으면 그 케이스에 이어 올린다
      const id = notice
        ? await createFromLink(notice.url, docClass, usable > 0)
        : await createFromFiles(files, docClass)
      if (!id) { setError(RFP_INTAKE.failed); return }
      setCaseId(id)

      for (const f of files) {
        if (f.error) continue
        const form = new FormData()
        form.append('file', f.file)
        await fetch(`/api/rfp/cases/${id}/files`, { method: 'POST', body: form })
      }

      // 링크만으로 왔으면 서버가 이미 걸었다. 파일을 이어 올렸으면 **다 올린 지금** 건다 —
      // 먼저 걸면 뒤에 올라온 파일이 빠진 채로 읽힌다
      if (!notice || usable > 0) {
        await fetch(`/api/rfp/cases/${id}/analyze`, { method: 'POST' })
      }
      onDone?.(id)
    } catch {
      setError(RFP_INTAKE.failed)
    } finally {
      setBusy(false)
    }
  }, [docClass, files, notice, usable, onDone])

  // 링크 하나만 있어도 시작할 수 있다 — 첨부는 서버가 받아 온다
  const hasSource = usable > 0 || (notice?.attachments.length ?? 0) > 0
  const canSubmit = Boolean(docClass) && hasSource && !busy

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

      {/* ② 무엇을 읽나 — 링크 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{RFP_INTAKE.linkLabel}</span>
          <span className={styles.sectionDesc}>{RFP_INTAKE.linkHint}</span>
        </div>

        <div className={styles.linkRow}>
          <input
            className="input-field"
            type="url"
            value={link}
            placeholder={RFP_INTAKE.linkPlaceholder}
            onChange={(e) => setLink(e.target.value)}
            // 조합 중의 Enter 는 「확정」이지 「가져오기」가 아니다 (lib/ui/ime SSOT)
            onKeyDown={(e) => { if (isEnterKey(e) && link.trim()) { e.preventDefault(); void fetchNotice() } }}
          />
          <NbButton variant="secondary" onClick={() => void fetchNotice()} disabled={!link.trim() || linking}>
            <Link2 size={14} />
            {linking ? RFP_INTAKE.fetchingNotice : RFP_INTAKE.fetchNotice}
          </NbButton>
        </div>

        {linkError && (
          <div className={styles.noticeFound}>
            <span className={styles.sectionDesc}>{linkError}</span>
          </div>
        )}

        {notice && (
          <div className={styles.noticeFound}>
            <div className={styles.between}>
              {/* 무엇을 분석하는지 사람이 눈으로 확인하고 시작한다 */}
              <span className={styles.sectionTitle}>{notice.title ?? RFP_INTAKE.linkTitleUnknown}</span>
              <NbBadge status={notice.attachments.length > 0 ? 'note' : 'blocker'}>
                {RFP_INTAKE.linkAttachments} {notice.attachments.length}
              </NbBadge>
            </div>

            {notice.agency && <span className={styles.sectionDesc}>{notice.agency}</span>}

            {notice.attachments.length > 0 && (
              <div className={styles.noticeFiles}>
                {notice.attachments.map((a) => (
                  <span key={a.url} className={styles.row}>
                    <FileText size={14} />
                    <span>{a.name}</span>
                  </span>
                ))}
              </div>
            )}

            {/* 못 찾았으면 왜 못 찾았는지와, 사람이 직접 열 주소를 준다 */}
            {notice.reason && (
              <span className={styles.sectionDesc}>{rfpNoticeReasonText(notice.reason)}</span>
            )}

            <div className={styles.row}>
              <NbButton variant="ghost" href={notice.url} target="_blank">
                <ExternalLink size={12} />
                {RFP_INTAKE.openNotice}
              </NbButton>
              <NbButton variant="ghost" onClick={clearNotice}>{RFP_INTAKE.linkClear}</NbButton>
            </div>
          </div>
        )}
      </section>

      {/* ③ 무엇을 읽나 — 파일 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <div className={styles.between}>
            <span className={styles.sectionTitle}>{RFP_INTAKE.fileLabel}</span>
            {files.length > 0 && <NbBadge status="note">{usable} / {files.length}</NbBadge>}
          </div>
          <span className={styles.sectionDesc}>{RFP_INTAKE.fileHint}</span>
          {/* 이름을 왜 안 묻는지 화면이 말한다 — 안 말하면 «칸이 빠졌나»로 읽힌다 */}
          <span className={styles.sectionDesc}>{RFP_INTAKE.titleFromDoc}</span>
          <span className={styles.sectionDesc}>{RFP_INTAKE.linkOrFile}</span>
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
