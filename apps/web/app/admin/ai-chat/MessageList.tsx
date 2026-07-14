'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { ArrowDown, RotateCcw, MessageSquare, AlertCircle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MessageBubble, { type StreamDraft } from './MessageBubble'
import type { ChatMessageView } from './AiChatClient'

const EXAMPLE_PROMPTS = [
  '이 프로젝트의 아키텍처를 요약해줘',
  'TypeScript 제네릭을 예제로 설명해줘',
  '주간 회고를 정리하는 좋은 방법은?',
]

interface MessageListProps {
  messages: ChatMessageView[]
  streamDraft: StreamDraft | null
  loading: boolean
  error: string | null
  isStreaming: boolean
  thinkingText: string | null
  thinkingSupported: boolean
  onRetry: () => void
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onPromptClick: (prompt: string) => void
  onRegenerate: () => void
  onEditSubmit: (messageId: string, content: string, attachmentIds: string[]) => void
  onFeedback: (messageId: string, value: 1 | -1 | null) => void
  onOpenArtifact: (identity: string) => void
  onBranchNav: (rootId: string, versionId: string) => void
  /** S3 §5-5 — 과거 분기 열람 중이면 재생성·편집 액션 숨김. */
  locked: boolean
  /** S3 §4-3 — 스트림 중 web_search 진행 인디케이터. */
  webSearching: boolean
}

export default function MessageList({
  messages,
  streamDraft,
  loading,
  error,
  isStreaming,
  thinkingText,
  thinkingSupported,
  onRetry,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onPromptClick,
  onRegenerate,
  onEditSubmit,
  onFeedback,
  onOpenArtifact,
  onBranchNav,
  locked,
  webSearching,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const prevHeightRef = useRef<number | null>(null)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    endRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 80
    atBottomRef.current = atBottom
    setShowJump(!atBottom && messages.length > 0)

    // 상단 근접 → 과거 메시지 로드 (스크롤 위치 보존은 useLayoutEffect에서)
    if (el.scrollTop < 48 && hasOlder && !loadingOlder) {
      prevHeightRef.current = el.scrollHeight
      onLoadOlder()
    }
  }

  // prepend 후 스크롤 위치 보존
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && prevHeightRef.current != null) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current
      prevHeightRef.current = null
    }
  }, [messages])

  // 새 메시지/스트리밍 델타 → 사용자가 하단에 있을 때만 자동 스크롤
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom('auto')
  }, [messages.length, streamDraft?.content, streamDraft?.thinking, scrollToBottom])

  // 초기 로드 완료 시 하단으로
  useEffect(() => {
    if (!loading) {
      atBottomRef.current = true
      scrollToBottom('auto')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ── 로딩 상태 ──
  if (loading) {
    return (
      <div className="ai-chat-state" aria-busy="true">
        <AXDotLoader size={7} color="var(--brand)" />
        <span style={{ fontSize: 'var(--fs-sm)' }}>대화를 불러오는 중…</span>
      </div>
    )
  }

  // ── 에러 상태 ──
  if (error) {
    return (
      <div className="ai-chat-state" role="alert">
        <AlertCircle size={28} color="var(--danger)" />
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--danger)', fontWeight: 600 }}>{error}</span>
        <button
          type="button"
          className="btn-primary"
          onClick={onRetry}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44 }}
        >
          <RotateCcw size={14} />
          다시 시도
        </button>
      </div>
    )
  }

  // ── 빈 상태 ──
  if (messages.length === 0 && !streamDraft) {
    return (
      <div className="ai-chat-state">
        <MessageSquare size={32} style={{ opacity: 0.4 }} />
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          무엇을 도와드릴까요?
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>아래 예시로 시작하거나 직접 질문을 입력하세요.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)', width: '100%', alignItems: 'center' }}>
          {EXAMPLE_PROMPTS.map((p) => (
            <button key={p} type="button" className="ai-chat-example-btn" onClick={() => onPromptClick(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── 메시지 목록 ──
  return (
    <div className="ai-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="ai-chat-messages">
        {loadingOlder && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2)' }}>
            <AXDotLoader size={5} color="var(--text-muted)" />
          </div>
        )}
        {(() => {
          // 활성 스레드에서 마지막 assistant id — 재생성 버튼 노출 조건 (스트리밍 중엔 없음)
          let lastAssistantId: string | null = null
          if (!streamDraft) {
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') { lastAssistantId = messages[i].id; break }
            }
          }
          return messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isLastAssistant={m.role === 'assistant' && m.id === lastAssistantId}
              thinkingSupported={thinkingSupported}
              onRegenerate={locked ? undefined : onRegenerate}
              onEditSubmit={locked ? undefined : onEditSubmit}
              onFeedback={onFeedback}
              onOpenArtifact={onOpenArtifact}
              onBranchNav={onBranchNav}
            />
          ))
        })()}
        {streamDraft && (
          <MessageBubble
            message={streamDraft}
            isStreaming={isStreaming}
            thinkingText={thinkingText}
            thinkingSupported={thinkingSupported}
          />
        )}
        {webSearching && (
          <div className="ai-chat-toolstatus" role="status" aria-live="polite">
            <AXDotLoader size={4} color="var(--brand)" />
            웹 검색 중…
          </div>
        )}
        <div ref={endRef} />
        {showJump && (
          <button type="button" className="ai-chat-jump" onClick={() => scrollToBottom('smooth')} aria-label="최신 메시지로 이동">
            <ArrowDown size={13} />
            최신으로
          </button>
        )}
      </div>
    </div>
  )
}
