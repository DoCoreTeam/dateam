'use client'

// 목록 심층분석 — §FR-11-2 문서 상세 드로어(열람+제목편집+삭제/복원) + 배출 4경로 재노출
// (경로1 파일 내보내기·경로4 AI채팅 이어가기는 저장된 문서에서도 다시 실행 가능해야 재가공 흐름이 완결된다).
// 모달 표준(§2-2) 준수: useEscClose·X닫기·tape-title·boxShadow(var(--shadow-modal))·backdrop(var(--modal-backdrop)).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, MessageSquarePlus, Pencil, Share2, Trash2, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import { getDocument, updateDocument, deleteDocument, type AnalysisDocumentSummary } from './document-actions'
import { continueInChat } from './session-persist-actions'
import WorkflowHandoffModal from './WorkflowHandoffModal'

interface Props {
  documentId: string
  onClose: () => void
  onChanged: (patch: Partial<AnalysisDocumentSummary>) => void
  onDeleted: () => void
}

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

type ExportFormat = 'md' | 'txt' | 'docx' | 'pdf'

export default function DocumentDetailDrawer({ documentId, onClose, onChanged, onDeleted }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showHandoff, setShowHandoff] = useState(false)

  useEffect(() => {
    let alive = true
    getDocument(documentId).then((r) => {
      if (!alive) return
      if (!r.ok) { setError(r.error); setLoading(false); return }
      setTitle(r.document.title)
      setBodyMd(r.document.bodyMd)
      setTitleDraft(r.document.title)
      setLoading(false)
    })
    return () => { alive = false }
  }, [documentId])

  async function saveTitle() {
    if (!titleDraft.trim() || savingTitle) return
    setSavingTitle(true)
    const r = await updateDocument(documentId, { title: titleDraft })
    setSavingTitle(false)
    if (!r.ok) { setError(r.error); return }
    setTitle(titleDraft.trim())
    onChanged({ title: titleDraft.trim() })
    setEditingTitle(false)
  }

  async function handleDelete() {
    if (deleting || !window.confirm('이 문서를 삭제할까요? 나중에 휴지통에서 되돌릴 수 있습니다.')) return
    setDeleting(true)
    const r = await deleteDocument(documentId)
    setDeleting(false)
    if (r.ok) onDeleted()
    else setError(r.error)
  }

  async function handleContinueChat() {
    const r = await continueInChat({ itemText: title, resultText: bodyMd })
    if (r.ok) router.push(`/ai-chat?c=${r.conversationId}`)
  }

  async function handleExport(format: ExportFormat) {
    const conv = { title, provider: 'gemini', model: '', createdAt: new Date().toISOString() }
    const messages = [{ role: 'assistant' as const, content: bodyMd, createdAt: conv.createdAt }]
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
        body: JSON.stringify({ title, sections: [{ itemText: title, resultText: bodyMd }] }),
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

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '100%', maxWidth: 640, height: '100%', background: 'var(--color-surface)', boxShadow: 'var(--shadow-modal)', overflowY: 'auto', padding: 'var(--space-6)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: 'var(--space-3)' }}>
          {editingTitle ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flex: 1, alignItems: 'center' }}>
              <input className="input-field" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={120} autoFocus style={{ flex: 1, minHeight: 40 }} />
              <button type="button" onClick={saveTitle} disabled={savingTitle} aria-label="제목 저장"
                style={{ minHeight: 40, minWidth: 40, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', borderRadius: 'var(--radius)', color: 'var(--success)', cursor: 'pointer' }}>
                <Check size={16} />
              </button>
            </div>
          ) : (
            <h3 className="tape-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {title}
              <button type="button" onClick={() => { setTitleDraft(title); setEditingTitle(true) }} aria-label="제목 편집"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>
                <Pencil size={14} />
              </button>
            </h3>
          )}
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', flexShrink: 0 }}><X size={18} /></button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>불러오는 중…</p>
        ) : error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {(['md', 'txt', 'docx', 'pdf'] as ExportFormat[]).map((fmt) => (
                <NbButton key={fmt} variant="ghost" onClick={() => handleExport(fmt)} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Download size={14} /> {fmt}
                </NbButton>
              ))}
              <NbButton variant="ghost" onClick={() => setShowHandoff(true)} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Share2 size={14} /> 업무로 전달
              </NbButton>
              <NbButton variant="ghost" onClick={handleContinueChat} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MessageSquarePlus size={14} /> AI채팅 이어가기
              </NbButton>
              <NbButton variant="danger" onClick={handleDelete} disabled={deleting} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <Trash2 size={14} /> 삭제
              </NbButton>
            </div>

            <div style={{ border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-4)' }}>
              <MarkdownMessage content={bodyMd} />
            </div>
          </>
        )}
      </div>

      {showHandoff && <WorkflowHandoffModal title={title} bodyMd={bodyMd} onClose={() => setShowHandoff(false)} />}
    </div>
  )
}
