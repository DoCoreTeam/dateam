'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, RotateCcw, MessageSquare } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
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
  const msgAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 새 메시지뿐 아니라 답변이 스트리밍으로 채워질 때도(내용이 늘어날 때마다) 맨 아래로 자동 스크롤.
  //   (버그: 예전엔 messages.length 변화에만 스크롤 → 답변이 길어져도 안 내려가 사용자가 직접 스크롤해야 했음.)
  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : ''
  useEffect(() => {
    if (msgAreaRef.current) {
      msgAreaRef.current.scrollTop = msgAreaRef.current.scrollHeight
    }
  }, [messages.length, lastContent])

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

    // placeholder streaming message
    const streamingMsg: ChatMessage = { role: 'assistant', content: '', streaming: true }
    setMessages((prev) => [...prev, streamingMsg])

    try {
      const res = await fetch('/api/pricing/gpu/db-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), history }),
      })

      if (!res.ok || !res.body) {
        let errMsg = 'AI 오류'
        try { const j = await res.json(); errMsg = j.error ?? errMsg } catch { /* ignore */ }
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: '', error: errMsg }
          return next
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue
          try {
            const evt = JSON.parse(jsonStr) as {
              chunk?: string
              done?: boolean
              answer?: string
              data?: Record<string, unknown>[]
              source_tables?: string[]
              found?: boolean
              error?: string
            }
            if (evt.chunk !== undefined) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + evt.chunk }
                }
                return next
              })
            } else if (evt.done) {
              if (evt.error) {
                setMessages((prev) => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'assistant', content: '', error: evt.error }
                  return next
                })
              } else {
                setMessages((prev) => {
                  const next = [...prev]
                  next[next.length - 1] = {
                    role: 'assistant',
                    content: evt.answer ?? '',
                    streaming: false,
                    data: evt.data,
                    source_tables: evt.source_tables,
                    found: evt.found,
                  }
                  return next
                })
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: '', error: '네트워크 오류' }
        return next
      })
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
      <div style={{ marginTop: 8, maxWidth: '100%', overflow: 'hidden' }}>
        <table className="table-base table-card" style={{ fontSize: 11, width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={{ wordBreak: 'break-word' }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {cols.map((c, ci) => (
                  <td key={c} style={{ wordBreak: 'break-word' }}
                    {...(ci === 0 ? { className: 'card-header' } : { 'data-label': c })}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 0 }}>
      {/* 메시지 영역 */}
      <div ref={msgAreaRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
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
              maxWidth: '88%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? 'var(--gpu-accent, var(--info))' : 'var(--gpu-surface2, var(--surface-muted))',
              color: msg.role === 'user' ? '#fff' : 'var(--gpu-text)',
              fontSize: 13,
              lineHeight: 1.6,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              minWidth: 0,
            }}>
              {msg.error ? (
                <span style={{ color: msg.role === 'user' ? 'var(--danger-border)' : 'var(--danger)' }}>{msg.error}</span>
              ) : (
                <>
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  {msg.streaming && msg.content.length === 0 && (
                    <span className="db-chat-cursor" />
                  )}
                  {msg.streaming && msg.content.length > 0 && (
                    <span className="db-chat-cursor" />
                  )}
                  {!msg.streaming && msg.data && msg.data.length > 0 && renderTable(msg.data)}
                  {!msg.streaming && msg.source_tables && msg.source_tables.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>
                      참조: {msg.source_tables.join(', ')}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

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
      <div style={{ padding: '12px 16px', borderTop: 'var(--hairline) solid var(--gpu-border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          ref={inputRef}
          data-testid="db-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="GPU 견적/가격/공급사에 대해 질문하세요..."
          rows={2}
          style={{
            flex: 1, resize: 'none', border: 'var(--hairline) solid var(--gpu-border)', borderRadius: 8,
            padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            background: 'var(--gpu-surface, #fff)', color: 'var(--gpu-text)',
            minWidth: 0,
          }}
          disabled={loading}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
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
