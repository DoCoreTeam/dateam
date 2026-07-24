'use client'

// 목록 심층분석 — 완전 대화형(④). 좌: 항목(의미블록) 목록 / 우: 선택 항목과의 다회차 채팅.
// 각 전송은 result_text에 스냅샷(status='done') → "종합하고 결과 보기"로 단일 문서 생성 후 결과 화면 진입.

import { useEffect, useState } from 'react'
import { Send, Sparkles, MessageSquareText, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from '@/app/admin/ai-chat/MarkdownMessage'
import { getItemMessages, sendItemMessage, synthesizeSession, type ItemMessage } from './analyze-converse-actions'

interface ConverseItem {
  idx: number
  title: string
}

interface Props {
  sessionId: string
  items: ConverseItem[]
  onSynthesized: () => void
  onBack: () => void
}

export default function ItemConversePanel({ sessionId, items, onSynthesized, onBack }: Props) {
  const [selected, setSelected] = useState(0)
  const [messages, setMessages] = useState<Record<number, ItemMessage[]>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = items[selected]
  const thread = current ? messages[current.idx] ?? [] : []
  const doneIdxs = new Set(Object.entries(messages).filter(([, m]) => m.some((x) => x.role === 'assistant')).map(([k]) => Number(k)))

  useEffect(() => {
    if (!current || messages[current.idx]) return
    setLoadingThread(true)
    getItemMessages(sessionId, current.idx).then((r) => {
      setLoadingThread(false)
      if (r.ok) setMessages((prev) => ({ ...prev, [current.idx]: r.messages }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sessionId])

  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text || !current || sending) return
    setSending(true)
    setError(null)
    // 낙관적 사용자 메시지 표시.
    const optimisticSeq = (thread.length > 0 ? Math.max(...thread.map((m) => m.seq)) : 0) + 1
    setMessages((prev) => ({
      ...prev,
      [current.idx]: [...(prev[current.idx] ?? []), { seq: optimisticSeq, role: 'user', content: text }],
    }))
    setInput('')
    const r = await sendItemMessage(sessionId, current.idx, text)
    setSending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setMessages((prev) => ({
      ...prev,
      [current.idx]: [...(prev[current.idx] ?? []), { seq: optimisticSeq + 1, role: 'assistant', content: r.assistant }],
    }))
  }

  async function handleSynthesize(): Promise<void> {
    if (synthesizing) return
    setSynthesizing(true)
    setError(null)
    const r = await synthesizeSession(sessionId)
    setSynthesizing(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onSynthesized()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span className="tape-title">항목별 지시 · 대화</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <NbButton variant="ghost" onClick={onBack}>그룹으로</NbButton>
          <NbButton onClick={handleSynthesize} disabled={synthesizing || doneIdxs.size === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
            {synthesizing ? <AXDotLoader size={5} color="currentColor" /> : <Sparkles size={16} />}
            {synthesizing ? '종합 중…' : '종합하고 결과 보기'}
          </NbButton>
        </div>
      </div>

      <div className="responsive-grid-2">
        {/* 좌: 항목 목록 */}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {items.map((it, i) => {
            const active = i === selected
            const answered = doneIdxs.has(it.idx)
            return (
              <li key={it.idx}>
                <button type="button" onClick={() => setSelected(i)}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    border: active ? 'var(--border-w-2) solid var(--brand)' : 'var(--hairline) solid var(--border-color)',
                    background: active ? 'var(--brand-soft)' : 'var(--color-surface)',
                    borderRadius: 'var(--radius)', padding: 'var(--space-3)',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44,
                  }}>
                  {answered ? <Check size={14} color="var(--success)" /> : <MessageSquareText size={14} color="var(--text-faint)" />}
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: active ? 600 : 400, minWidth: 0, wordBreak: 'break-word' }}>
                    {i + 1}. {it.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* 우: 대화 */}
        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 320 }}>
          {current && (
            <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{current.title}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {loadingThread ? (
              <AXDotLoader size={5} color="var(--text-muted)" />
            ) : thread.length === 0 ? (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                이 항목에 어떤 작업을 원하는지 지시해 보세요. (예: 요약 / 리스크 / 표로 정리 / 실행계획)
              </p>
            ) : (
              thread.map((m) => (
                <div key={m.seq} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  background: m.role === 'user' ? 'var(--brand-soft)' : 'var(--surface-bg)',
                  border: 'var(--hairline) solid var(--border-color)',
                  borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-3)',
                }}>
                  {m.role === 'user'
                    ? <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    : <MarkdownMessage content={m.content} />}
                </div>
              ))
            )}
            {sending && <AXDotLoader size={5} color="var(--text-muted)" />}
          </div>

          {error && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginTop: 'auto' }}>
            <textarea className="input-field" rows={2} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() } }}
              placeholder="지시를 입력하세요 (⌘/Ctrl+Enter 전송)"
              style={{ resize: 'vertical', fontFamily: 'inherit', flex: 1 }} />
            <NbButton onClick={handleSend} disabled={sending || !input.trim()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44, flexShrink: 0 }}>
              <Send size={16} /> 전송
            </NbButton>
          </div>
        </div>
      </div>
    </div>
  )
}
