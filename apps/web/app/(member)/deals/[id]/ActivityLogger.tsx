'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useFormCore } from '@/lib/forms/useFormCore'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'

const TYPES = [
  { value: 'call', label: '통화' },
  { value: 'email', label: '이메일' },
  { value: 'meeting', label: '미팅' },
  { value: 'note', label: '메모' },
] as const

interface Props { dealId: string }

export default function ActivityLogger({ dealId }: Props) {
  const router = useRouter()
  const [type, setType] = useState<string>('note')
  const formRef = useRef<HTMLFormElement>(null)
  const draft = useFormCore<string>({ formId: 'deal-activity', recordId: dealId, initial: '', scopeRef: formRef })
  const content = draft.value
  const setContent = draft.set
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/deals/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId, type, content }),
    })
    if (res.ok) {
      setContent('')
      draft.clear()
      setOpen(false)
      router.refresh()
    } else {
      const d = await res.json() as { error?: string }
      setError(d.error ?? '오류')
    }
    setLoading(false)
  }

  async function handleAiParse() {
    if (!content.trim()) { setError('내용을 먼저 입력하세요'); return }
    setAiLoading(true)
    setError('')
    const res = await fetch('/api/deals/ai-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId, raw_text: content }),
    })
    const data = await res.json() as { summary?: string; error?: string }
    if (res.ok && data.summary) {
      setContent(data.summary)
    } else {
      setError(data.error ?? 'AI 파싱 오류')
    }
    setAiLoading(false)
  }

  return (
    <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-primary" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--space-2) var(--space-4)', minHeight: '36px' }}>
          + 활동 기록
        </button>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <DraftRestoreBanner show={draft.hasDraft} onRestore={draft.restore} onDiscard={draft.discard} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                style={{
                  padding: '0.375rem 0.75rem',
                  borderRadius: '9999px',
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  border: 'var(--hairline) solid',
                  cursor: 'pointer',
                  background: type === t.value ? 'var(--brand)' : 'white',
                  color: type === t.value ? 'white' : 'var(--text-muted)',
                  borderColor: type === t.value ? 'var(--brand)' : 'var(--color-border)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
            rows={3}
            placeholder="활동 내용을 입력하세요... (Ctrl+Enter 저장)"
            style={{ width: '100%', padding: '0.625rem 0.75rem', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', resize: 'vertical', boxSizing: 'border-box' }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button type="submit" disabled={loading} className="btn-primary" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--space-2) var(--space-4)', minHeight: '36px' }}>
              {loading ? '저장중...' : '저장'}{!loading && <span style={{ fontSize: '0.65rem', opacity: 0.65, marginLeft: '0.3rem' }}>Ctrl+↵</span>}
            </button>
            <button type="button" onClick={handleAiParse} disabled={aiLoading} style={{ fontSize: 'var(--fs-sm)', padding: '0.5rem 0.875rem', minHeight: '36px', background: 'var(--info-bg)', color: 'var(--info)', border: 'var(--hairline) solid var(--info-border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600 }}>
              {aiLoading ? 'AI분석중...' : '🤖 AI정리'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setContent(''); draft.clear(); setError('') }} style={{ fontSize: 'var(--fs-sm)', padding: '0.5rem 0.875rem', minHeight: '36px', background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-muted)' }}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
