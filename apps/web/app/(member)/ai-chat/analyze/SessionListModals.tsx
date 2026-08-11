'use client'

// 목록 심층분석 세션 목록(§C4)의 모달·드로어 3종 — SessionListClient.tsx에서 분리(300줄 제한).
// 모달 표준(§2-2): useEscClose·X닫기·tape-title·광원형 그림자·통일 backdrop.

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X, Copy, Check, FolderPlus, Share2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useEscClose } from '@/lib/use-esc-close'
import { renameAnalysisSession, type AnalysisSessionSummary } from './session-list-actions'
import { getAnalysisSession, type AnalysisSessionDetail } from './session-persist-actions'
import { createDocument } from './document-actions'
import ExportMenu, { type ExportFormat } from './ExportMenu'
import WorkflowHandoffModal from './WorkflowHandoffModal'
import ScrollJumpButtons from '@/components/ui/ScrollJumpButtons'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 세션 export/저장용 본문 — 종합(synth)이 있으면 그것, 없으면 항목 결과를 이어붙인다. */
function sessionBodyMd(detail: AnalysisSessionDetail): string {
  if (detail.synthText && detail.synthText.trim()) return detail.synthText
  return detail.items
    .filter((i) => (i.resultText ?? '').trim())
    .map((i) => `## ${i.text}\n\n${i.resultText}`)
    .join('\n\n')
}

const BACKDROP = 'var(--modal-backdrop)'
const MODAL_SHADOW = 'var(--shadow-modal)'

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: BACKDROP, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: wide ? 420 : 400, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: MODAL_SHADOW, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** 세션 이름변경 모달(§C4 CRUD). */
export function RenameModal({ session, onClose, onRenamed }: { session: AnalysisSessionSummary; onClose: () => void; onRenamed: (title: string) => void }) {
  useEscClose(onClose)
  const [title, setTitle] = useState(session.title)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (busy || !title.trim()) return
    setBusy(true); setErr(null)
    const r = await renameAnalysisSession(session.id, title)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onRenamed(title.trim())
  }

  return (
    <ModalShell title="세션 이름변경" onClose={onClose} wide>
      <label className="label" htmlFor="rename-title">제목</label>
      <input id="rename-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)}
        maxLength={60} autoFocus style={{ marginTop: 'var(--space-1)', marginBottom: 'var(--space-3)' }} />
      {err && <p role="alert" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <NbButton variant="ghost" onClick={onClose} type="button">취소</NbButton>
        <NbButton onClick={submit} disabled={busy || !title.trim()} type="button">{busy ? '저장중…' : '저장'}</NbButton>
      </div>
    </ModalShell>
  )
}

/** 삭제/되돌리기 공용 확인 모달(§C4 CRUD). 1건·N건(선택 일괄) 공용 — error를 주면 모달 안에서 실패를 보여준다. */
export function ConfirmModal({ title, message, confirmLabel, danger, error, onClose, onConfirm }: {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; error?: string | null
  onClose: () => void; onConfirm: () => void | Promise<void>
}) {
  useEscClose(onClose)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    await onConfirm()
    setBusy(false)
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</p>
      {error && (
        <p role="alert" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <NbButton variant="ghost" onClick={onClose} type="button">취소</NbButton>
        <NbButton variant={danger ? 'danger' : 'primary'} onClick={run} disabled={busy} type="button">{busy ? '처리중…' : confirmLabel}</NbButton>
      </div>
    </ModalShell>
  )
}

/**
 * 세션 상세(읽기전용) 드로어 — getAnalysisSession으로 원문·항목·결과 조회.
 * 실제 "이어서 분석"은 '새 분석' 탭의 자체 이전분석 목록(AnalyzeClient 내장)에서 진행
 * (분석 재개 로직은 그쪽 SSOT — 여기서 중복 구현하지 않음).
 */
export function SessionDetailDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  useEscClose(onClose)
  const [detail, setDetail] = useState<AnalysisSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [showHandoff, setShowHandoff] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    getAnalysisSession(sessionId).then((r) => {
      if (!alive) return
      if (!r.ok) { setError(r.error); setLoading(false); return }
      setDetail(r.session)
      setLoading(false)
    })
    return () => { alive = false }
  }, [sessionId])

  const body = detail ? sessionBodyMd(detail) : ''
  const title = detail?.title ?? '세션'
  const canAct = !!body.trim()

  function copyBody(): void {
    navigator.clipboard.writeText(body).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleExport(format: ExportFormat): Promise<void> {
    const conv = { title, provider: 'gemini', model: '', createdAt: new Date().toISOString() }
    const messages = [{ role: 'assistant' as const, content: body, createdAt: conv.createdAt }]
    if (format === 'md') {
      const { conversationToMarkdown } = await import('@/lib/ai-chat/export')
      downloadTextFile(`${title}.md`, conversationToMarkdown(conv, messages), 'text/markdown')
    } else if (format === 'txt') {
      const { conversationToPlainText } = await import('@/lib/ai-chat/export')
      downloadTextFile(`${title}.txt`, conversationToPlainText(conv, messages), 'text/plain')
    } else if (format === 'docx') {
      const { downloadConversationDocx } = await import('@/lib/ai-chat/export-docx')
      await downloadConversationDocx(conv, messages)
    } else {
      const res = await fetch('/api/admin/ai-chat/analyze-export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, sections: [{ itemText: title, resultText: body }] }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
  }

  async function handleSave(): Promise<void> {
    if (!detail || saving) return
    setSaving(true)
    const r = await createDocument({ sessionId, title, bodyMd: body, docType: detail.docType })
    setSaving(false)
    if (r.ok) setSavedId(r.id)
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: BACKDROP, display: 'flex', justifyContent: 'flex-end' }}>
      <div ref={scrollRef} style={{ width: '100%', maxWidth: 520, height: '100%', background: 'var(--color-surface)', boxShadow: MODAL_SHADOW, overflowY: 'auto', padding: 'var(--space-6)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>세션 상세</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>불러오는 중…</p>
        ) : error || !detail ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error ?? '세션을 찾을 수 없습니다'}</p>
        ) : (
          <>
            {/* 문서 상세와 동일한 배출 액션 — 세션도 결과가 있으면 다운로드·복사·저장·전달 가능 */}
            {canAct && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <ExportMenu onExport={handleExport} />
                <NbButton variant="ghost" onClick={copyBody} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '복사됨' : '복사'}
                </NbButton>
                {savedId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>
                    <Check size={14} /> 저장됨 —{' '}
                    <Link href="/ai-chat/analyze?tab=documents" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>문서함</Link>
                  </span>
                ) : (
                  <NbButton variant="secondary" onClick={handleSave} disabled={saving} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <FolderPlus size={14} /> {saving ? '저장 중…' : '문서함에 저장'}
                  </NbButton>
                )}
                <NbButton variant="ghost" onClick={() => setShowHandoff(true)} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Share2 size={14} /> 업무로 전달
                </NbButton>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {detail.items.map((it) => (
                <div key={it.idx} style={{ padding: 'var(--space-3)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)' }}>
                  <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{it.text}</p>
                  {/* 심화 결과는 마크다운 — 실시간 화면(AnalysisResultItem)과 동일하게 렌더한다. */}
                  {it.resultText && <MarkdownMessage content={it.resultText} />}
                  {it.status !== 'done' && (
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{it.status === 'error' ? '분석 실패' : it.status === 'running' ? '분석중' : '대기중'}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ScrollJumpButtons targetRef={scrollRef} />
      {detail && showHandoff && (
        <WorkflowHandoffModal title={title} bodyMd={body} onClose={() => setShowHandoff(false)} />
      )}
    </div>
  )
}
