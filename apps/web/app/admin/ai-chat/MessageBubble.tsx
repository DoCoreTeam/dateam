'use client'

import { useState } from 'react'
import { Copy, Check, Square, AlertCircle } from 'lucide-react'
import type { AiChatMessage } from '@/types/database'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from './MarkdownMessage'

/** 스트리밍 중 임시 어시스턴트 말풍선 (DB 확정 전). */
export interface StreamDraft {
  role: 'assistant'
  content: string
  thinking: string | null
  streaming: boolean
  stopped?: boolean
  error?: string | null
}

export type BubbleMessage = AiChatMessage | StreamDraft

interface MessageBubbleProps {
  message: BubbleMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const role = message.role
  const content = message.content
  const thinking = message.thinking
  const streaming = 'streaming' in message ? message.streaming : false
  const stopped = 'stopped' in message ? Boolean(message.stopped) : false
  const error = 'error' in message ? message.error : null

  function handleCopy() {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* 무시 */
      },
    )
  }

  if (role === 'user') {
    return (
      <div className="ai-chat-row" data-role="user">
        <div className="ai-chat-bubble" data-role="user">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="ai-chat-row" data-role="assistant">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxWidth: '86%', minWidth: 0 }}>
        <div className="ai-chat-bubble" data-role="assistant">
          {/* 생각 과정 (Claude) — 스트리밍 중 펼침, 그 외 접힘 */}
          {thinking && thinking.trim().length > 0 && (
            <details className="ai-chat-thinking" open={streaming}>
              <summary>생각 과정</summary>
              <div className="ai-chat-thinking-body">{thinking}</div>
            </details>
          )}

          {content.length > 0 ? (
            <MarkdownMessage content={content} />
          ) : streaming && !error ? (
            <AXDotLoader size={5} color="var(--text-muted)" />
          ) : null}

          {/* 스트리밍 커서 */}
          {streaming && content.length > 0 && !error && <span className="db-chat-cursor" aria-hidden="true" />}

          {/* 에러 */}
          {error && (
            <div className="ai-chat-banner" data-tone="danger" role="alert" style={{ marginTop: 'var(--space-2)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <AlertCircle size={14} />
                {error}
              </span>
            </div>
          )}
        </div>

        {/* 메타 · 액션 */}
        {!streaming && (
          <div className="ai-chat-msg-meta">
            {stopped && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--warning)', fontWeight: 600 }}>
                <Square size={11} />
                중단됨
              </span>
            )}
            {content.length > 0 && (
              <button type="button" className="ai-chat-copy-btn" onClick={handleCopy} aria-label="메시지 복사">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? '복사됨' : '복사'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
