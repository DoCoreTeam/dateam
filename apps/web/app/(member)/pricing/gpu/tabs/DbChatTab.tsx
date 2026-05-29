'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, RotateCcw, MessageSquare } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  data?: Record<string, unknown>[]
  source_tables?: string[]
  found?: boolean
  error?: string
}

const QUICK_QUERIES = [
  'H100 최근 견적 알려줘',
  'A100 현재 최저가는?',
  '이번 달 견적 변동 이력',
  '검토 대기 중인 견적 몇 개야?',
]

export default function DbChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(query: string) {
    if (!query.trim() || loading) return

    const userMsg: ChatMessage = { role: 'user', content: query.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const history = newMessages.slice(-10).slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch('/api/pricing/gpu/db-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), history }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '', error: json.error ?? 'AI 오류' }])
      } else {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: json.answer ?? '',
          data: json.data,
          source_tables: json.source_tables,
          found: json.found,
        }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '', error: '네트워크 오류' }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function renderTable(data: Record<string, unknown>[]) {
    if (!data || data.length === 0) return null
    const cols = Object.keys(data[0])
    return (
      <div style={{ marginTop: 8 }}>
        <table className="table-base table-card" style={{ fontSize: 12 }}>
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {cols.map((c, ci) => (
                  <td key={c} {...(ci === 0 ? { className: 'card-header' } : { 'data-label': c })}>
                    {String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function escapeHtml(str: string) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderMarkdown(text: string) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code style="background:var(--gpu-border);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', minHeight: 400, gap: 0 }}>
      {/* 메시지 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--gpu-muted)', marginTop: 60 }}>
            <MessageSquare size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>GPU DB에 질문하세요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>견적·가격·공급사·이력 등 DB 데이터를 자연어로 조회합니다</div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? 'var(--gpu-accent, #2563eb)' : 'var(--gpu-surface2, #f3f4f6)',
              color: msg.role === 'user' ? '#fff' : 'var(--gpu-text)',
              fontSize: 13,
              lineHeight: 1.6,
            }}>
              {msg.error ? (
                <span style={{ color: msg.role === 'user' ? '#fca5a5' : '#ef4444' }}>{msg.error}</span>
              ) : (
                <>
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  {msg.data && msg.data.length > 0 && renderTable(msg.data)}
                  {msg.source_tables && msg.source_tables.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>
                      참조: {msg.source_tables.join(', ')}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '10px 14px', background: 'var(--gpu-surface2, #f3f4f6)', borderRadius: '12px 12px 12px 2px', fontSize: 13, color: 'var(--gpu-muted)' }}>
              분석 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 빠른 질문 */}
      {messages.length === 0 && (
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {QUICK_QUERIES.map((q) => (
            <button key={q} className="gpu-btn" style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => sendMessage(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {/* 입력 영역 */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gpu-border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          data-testid="db-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="GPU 견적/가격/공급사에 대해 질문하세요... (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
          style={{
            flex: 1, resize: 'none', border: '1px solid var(--gpu-border)', borderRadius: 8,
            padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            background: 'var(--gpu-surface, #fff)', color: 'var(--gpu-text)',
          }}
          disabled={loading}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            data-testid="db-chat-send"
            className="gpu-btn gpu-btn-primary"
            style={{ padding: '8px 12px' }}
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
          >
            <Send size={14} />
          </button>
          {messages.length > 0 && (
            <button className="gpu-btn" style={{ padding: '8px 12px' }}
              onClick={() => setMessages([])} title="대화 초기화">
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
