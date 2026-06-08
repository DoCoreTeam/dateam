'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
  const [content, setContent] = useState('')
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
    <div style={{ padding: '1rem 1.5rem', borderBottom: '2px solid var(--border-color)' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-primary" style={{ fontSize: '0.8125rem', padding: '0.5rem 1rem', minHeight: '36px' }}>
          + 활동 기록
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                style={{
                  padding: '0.375rem 0.75rem',
                  borderRadius: '9999px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  border: '1px solid',
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
            style={{ width: '100%', padding: '0.625rem 0.75rem', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="submit" disabled={loading} className="btn-primary" style={{ fontSize: '0.8125rem', padding: '0.5rem 1rem', minHeight: '36px' }}>
              {loading ? '저장중...' : '저장'}{!loading && <span style={{ fontSize: '0.65rem', opacity: 0.65, marginLeft: '0.3rem' }}>Ctrl+↵</span>}
            </button>
            <button type="button" onClick={handleAiParse} disabled={aiLoading} style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem', minHeight: '36px', background: '#f0f9ff', color: '#0284c7', border: '1px solid #bae6fd', borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600 }}>
              {aiLoading ? 'AI분석중...' : '🤖 AI정리'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setContent(''); setError('') }} style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem', minHeight: '36px', background: 'none', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-muted)' }}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
