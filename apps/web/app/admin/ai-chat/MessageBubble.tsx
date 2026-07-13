'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Copy,
  Check,
  Square,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Pencil,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  FileText,
  X,
} from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MarkdownMessage from './MarkdownMessage'
import CitationCards from './CitationCards'
import { extractArtifacts } from '@/lib/ai-chat/artifacts'
import type { ChatMessageView, AttachmentView } from './AiChatClient'

/** 스트리밍 중 임시 어시스턴트 말풍선 (DB 확정 전). */
export interface StreamDraft {
  role: 'assistant'
  content: string
  thinking: string | null
  streaming: boolean
  stopped?: boolean
  error?: string | null
}

export type BubbleMessage = ChatMessageView | StreamDraft

interface MessageBubbleProps {
  message: BubbleMessage
  isLastAssistant?: boolean
  isStreaming?: boolean
  thinkingText?: string | null
  thinkingSupported?: boolean
  onRegenerate?: () => void
  onEditSubmit?: (messageId: string, content: string, attachmentIds: string[]) => void
  onFeedback?: (messageId: string, value: 1 | -1 | null) => void
  /** S3 §2-3 — 본문 내 artifact 승격 펜스를 칩으로 치환·클릭 시 패널 오픈. */
  onOpenArtifact?: (identity: string) => void
  /** S3 §5-5 — user 버블 ‹k/n› 분기 전환(대상 versionId 전달). */
  onBranchNav?: (rootId: string, versionId: string) => void
}

function isPersisted(m: BubbleMessage): m is ChatMessageView {
  return 'id' in m
}

function AttachmentPreview({ att }: { att: AttachmentView }) {
  if (att.kind === 'image' && att.signedUrl) {
    return (
      <a href={att.signedUrl} target="_blank" rel="noopener noreferrer" aria-label={`이미지 첨부 ${att.filename} 새 탭에서 열기`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ai-chat-msg-image" src={att.signedUrl} alt={att.filename} />
      </a>
    )
  }
  return (
    <a className="ai-chat-msg-file" href={att.signedUrl || undefined} target="_blank" rel="noopener noreferrer">
      <FileText size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{att.filename}</span>
    </a>
  )
}

export default function MessageBubble({
  message,
  isLastAssistant = false,
  isStreaming = false,
  thinkingText = null,
  thinkingSupported = true,
  onRegenerate,
  onEditSubmit,
  onFeedback,
  onOpenArtifact,
  onBranchNav,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [thinkingOpen, setThinkingOpen] = useState(isStreaming)
  const editRef = useRef<HTMLTextAreaElement>(null)

  const role = message.role
  const content = message.content
  const stopped = 'stopped' in message ? Boolean(message.stopped) : false
  const error = 'error' in message ? message.error : null
  const persisted = isPersisted(message)

  // thinking: 스트리밍 중엔 라이브 버퍼, 완료·복원 후엔 영속값
  const thinkingContent = isStreaming ? (thinkingText ?? message.thinking) : message.thinking
  const showThinking =
    thinkingSupported !== false && !!thinkingContent && thinkingContent.trim().length > 0

  // 스트리밍 중 자동 펼침, 완료 시 자동 접힘
  useEffect(() => {
    setThinkingOpen(isStreaming)
  }, [isStreaming])

  useEffect(() => {
    if (isEditing) editRef.current?.focus()
  }, [isEditing])

  function handleCopy() {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

  function startEdit() {
    setEditDraft(content)
    setIsEditing(true)
  }

  function submitEdit() {
    const trimmed = editDraft.trim()
    if (!persisted || !onEditSubmit || trimmed.length === 0) return
    onEditSubmit(message.id, trimmed, [])
    setIsEditing(false)
  }

  // ── user 버블 ──
  if (role === 'user') {
    const atts: AttachmentView[] = persisted ? message.attachments : []
    return (
      <div className="ai-chat-row" data-role="user">
        <div className="ai-chat-turn">
          {atts.length > 0 && (
            <div className="ai-chat-msg-attachments">
              {atts.map((a) => (
                <AttachmentPreview key={a.id} att={a} />
              ))}
            </div>
          )}

          {isEditing ? (
            <div style={{ width: '100%', minWidth: 'min(72vw, 420px)' }}>
              <textarea
                ref={editRef}
                className="input-field"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={3}
                maxLength={32000}
                style={{ width: '100%', resize: 'vertical' }}
                aria-label="메시지 편집"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setIsEditing(false) }
                }}
              />
              <div className="ai-chat-edit-actions">
                <button type="button" className="ai-chat-copy-btn" onClick={() => setIsEditing(false)}>
                  <X size={12} /> 취소
                </button>
                <button type="button" className="ai-chat-send" onClick={submitEdit} disabled={editDraft.trim().length === 0}>
                  <Check size={14} /> 저장 후 재전송
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-chat-bubble" data-role="user">
              {content}
            </div>
          )}

          {persisted && !isEditing && (
            <div className="ai-chat-actions">
              <button type="button" className="ai-chat-copy-btn" onClick={handleCopy} aria-label="메시지 복사">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? '복사됨' : '복사'}
              </button>
              {onEditSubmit && (
                <button type="button" className="ai-chat-copy-btn" onClick={startEdit} aria-label="메시지 편집">
                  <Pencil size={12} /> 편집
                </button>
              )}
            </div>
          )}

          {persisted && !isEditing && message.branch && message.branch.count >= 2 && onBranchNav && (
            <div className="ai-chat-branch-nav" role="group" aria-label="편집 분기 탐색">
              <button
                type="button"
                className="ai-chat-branch-btn"
                onClick={() => {
                  const b = message.branch!
                  if (b.index > 1) onBranchNav(b.rootId, b.versions[b.index - 2])
                }}
                disabled={message.branch.index <= 1}
                aria-label="이전 분기"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="ai-chat-branch-count">
                {message.branch.index}/{message.branch.count}
              </span>
              <button
                type="button"
                className="ai-chat-branch-btn"
                onClick={() => {
                  const b = message.branch!
                  if (b.index < b.count) onBranchNav(b.rootId, b.versions[b.index])
                }}
                disabled={message.branch.index >= message.branch.count}
                aria-label="다음 분기"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── assistant 버블 ──
  const feedback = persisted ? message.feedback : null
  const citations = persisted ? message.citations : null
  // 스트리밍 중 파싱 금지(§2-3) — 영속 assistant에서만 artifact 승격 펜스 추출
  const artifacts = persisted && !isStreaming ? extractArtifacts(content) : undefined
  return (
    <div className="ai-chat-row" data-role="assistant">
      <div className="ai-chat-turn">
        <div className="ai-chat-bubble" data-role="assistant">
          {showThinking && (
            <details
              className="ai-chat-thinking"
              open={thinkingOpen}
              onToggle={(e) => setThinkingOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>
                <ChevronRight className="ai-chat-thinking-caret" size={13} />
                추론 과정
                {isStreaming && <AXDotLoader size={4} color="var(--text-muted)" />}
              </summary>
              <div className="ai-chat-thinking-body-md">
                <MarkdownMessage content={thinkingContent ?? ''} />
              </div>
            </details>
          )}

          {content.length > 0 ? (
            <MarkdownMessage content={content} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
          ) : isStreaming && !error ? (
            <AXDotLoader size={5} color="var(--text-muted)" />
          ) : null}

          {isStreaming && content.length > 0 && !error && <span className="db-chat-cursor" aria-hidden="true" />}

          {error && (
            <div className="ai-chat-banner" data-tone="danger" role="alert" style={{ marginTop: 'var(--space-2)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <AlertCircle size={14} />
                {error}
              </span>
            </div>
          )}
        </div>

        {citations && citations.length > 0 && <CitationCards citations={citations} />}

        {!isStreaming && (
          <div className="ai-chat-msg-meta">
            {stopped && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--warning)', fontWeight: 600 }}>
                <Square size={11} />
                중단됨
              </span>
            )}
            <div className="ai-chat-actions">
              {content.length > 0 && (
                <button type="button" className="ai-chat-copy-btn" onClick={handleCopy} aria-label="메시지 복사">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '복사됨' : '복사'}
                </button>
              )}
              {isLastAssistant && onRegenerate && (
                <button type="button" className="ai-chat-copy-btn" onClick={onRegenerate} aria-label="응답 재생성">
                  <RotateCcw size={12} /> 재생성
                </button>
              )}
              {persisted && onFeedback && (
                <>
                  <button
                    type="button"
                    className="ai-chat-copy-btn"
                    data-selected={feedback === 1}
                    onClick={() => onFeedback(message.id, feedback === 1 ? null : 1)}
                    aria-label="좋아요"
                    aria-pressed={feedback === 1}
                  >
                    <ThumbsUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="ai-chat-copy-btn"
                    data-selected={feedback === -1}
                    onClick={() => onFeedback(message.id, feedback === -1 ? null : -1)}
                    aria-label="싫어요"
                    aria-pressed={feedback === -1}
                  >
                    <ThumbsDown size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
