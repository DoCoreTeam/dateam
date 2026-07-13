'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Plus, Settings2 } from 'lucide-react'
import type { AiChatConversation, AiChatMessage, AiChatProviderId } from '@/types/database'
import { useSseChat, type StreamBody } from '@/lib/ai-chat/use-sse-chat'
import {
  createConversation,
  listConversations,
  getMessages,
  renameConversation,
  togglePin,
  updateConversationModel,
  softDeleteConversation,
  restoreConversation,
  setMessageFeedback,
} from './actions'
import ConversationSidebar from './ConversationSidebar'
import MessageList from './MessageList'
import Composer from './Composer'
import SystemPromptModal from './SystemPromptModal'
import type { StreamDraft } from './MessageBubble'

// ── 클라이언트 공용 뷰 타입 (API 키는 서버 전용 — 클라엔 라벨/모델만) ──
export interface ProviderView {
  id: AiChatProviderId
  label: string
  model: string
}

export interface ProviderCaps {
  vision: boolean
  thinking: boolean
}

/** getMessages items의 첨부 뷰 (서명URL은 조회 시마다 신규 발급). */
export interface AttachmentView {
  id: string
  filename: string
  mime: string
  kind: string
  sizeBytes: number
  signedUrl: string
}

/** 화면용 메시지 = 영속 메시지 + 세션2 필드(feedback·parent·attachments). */
export interface ChatMessageView extends AiChatMessage {
  feedback: -1 | 1 | null
  parent_message_id: string | null
  attachments: AttachmentView[]
}

export const PROVIDER_LABELS: Record<AiChatProviderId, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
}

// 서버가 세션2 필드를 아직 실을 수도/안 실을 수도 있어 관대하게 승격(병행 개발 안전).
type RawMessage = AiChatMessage &
  Partial<{ feedback: -1 | 1 | null; parent_message_id: string | null; attachments: AttachmentView[] }>

function toView(m: AiChatMessage): ChatMessageView {
  const r = m as RawMessage
  return {
    ...m,
    feedback: r.feedback ?? null,
    parent_message_id: r.parent_message_id ?? null,
    attachments: r.attachments ?? [],
  }
}

interface AiChatClientProps {
  initialConversations: AiChatConversation[]
  initialCursor: string | null
  initialMessages: AiChatMessage[]
  initialMsgCursor: string | null
  initialConversationId: string | null
  providers: ProviderView[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
  capabilities: Record<AiChatProviderId, ProviderCaps>
}

export default function AiChatClient({
  initialConversations,
  initialCursor,
  initialMessages,
  initialMsgCursor,
  initialConversationId,
  providers,
  defaultProvider,
  capabilities,
}: AiChatClientProps) {
  const router = useRouter()
  const sse = useSseChat()

  const [conversations, setConversations] = useState<AiChatConversation[]>(initialConversations)
  const [convCursor, setConvCursor] = useState<string | null>(initialCursor)
  const [loadingMore, setLoadingMore] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages.map(toView))
  const [msgCursor, setMsgCursor] = useState<string | null>(initialMsgCursor)
  const [msgLoading, setMsgLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)

  const [streamDraft, setStreamDraft] = useState<StreamDraft | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [recentlyDeleted, setRecentlyDeleted] = useState<{ id: string; title: string } | null>(null)
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)

  const initialDraft: ProviderView | null = defaultProvider
    ? providers.find((p) => p.id === defaultProvider.id) ?? {
        id: defaultProvider.id,
        label: PROVIDER_LABELS[defaultProvider.id],
        model: defaultProvider.model,
      }
    : providers[0] ?? null
  const [draftProvider, setDraftProvider] = useState<ProviderView | null>(initialDraft)

  const activeSend = useRef<{ done: boolean } | null>(null)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current)
    }
  }, [])

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null
  const curProvider: AiChatProviderId | null = selectedConv?.provider ?? draftProvider?.id ?? null
  const curModel: string | null = selectedConv?.model ?? draftProvider?.model ?? null
  const canCreate = providers.length > 0
  const visionSupported = curProvider ? capabilities[curProvider].vision : false
  const thinkingSupported = curProvider ? capabilities[curProvider].thinking : false

  // `messages`는 항상 "활성 스레드"를 직접 보유한다(불변식):
  //  - 서버(getMessages)가 이미 buildActiveThread 적용본을 반환 → 그대로 사용(재적용 금지: 재적용 시
  //    편집 메시지의 parent가 이미 절단돼 idx<0으로 skip되어 편집 질문이 사라짐 — 이중적용 버그).
  //  - 낙관적 편집은 편집 대상 인덱스에서 직접 절단해 불변식을 유지(handleEditSubmit).

  function updateUrl(id: string | null) {
    router.replace(id ? `/admin/ai-chat?c=${id}` : '/admin/ai-chat', { scroll: false })
  }

  async function refreshConversations() {
    const r = await listConversations({})
    if (r.ok && r.items) {
      setConversations(r.items)
      setConvCursor(r.nextCursor ?? null)
    }
  }

  async function loadMessages(id: string) {
    setMsgLoading(true)
    setMsgError(null)
    const r = await getMessages({ conversationId: id })
    if (r.ok) {
      setMessages((r.items ?? []).map(toView))
      setMsgCursor(r.nextCursor ?? null)
    } else {
      setMsgError(r.error ?? '메시지를 불러오지 못했습니다')
    }
    setMsgLoading(false)
  }

  // 스트림 완료/실패 후 조용한 재조회(로딩 상태 미표시 — 화면 유지)
  async function reloadMessages(id: string): Promise<boolean> {
    const r = await getMessages({ conversationId: id })
    if (r.ok) {
      setMessages((r.items ?? []).map(toView))
      setMsgCursor(r.nextCursor ?? null)
      return true
    }
    return false
  }

  function selectConversation(id: string) {
    setSidebarOpen(false)
    if (id === selectedId) return
    setSelectedId(id)
    updateUrl(id)
    setStreamDraft(null)
    loadMessages(id)
  }

  function retryLoad() {
    if (selectedId) loadMessages(selectedId)
  }

  function newChat() {
    setSelectedId(null)
    setMessages([])
    setMsgCursor(null)
    setStreamDraft(null)
    setMsgError(null)
    updateUrl(null)
    setSidebarOpen(false)
  }

  async function loadOlder() {
    if (!selectedId || !msgCursor || loadingOlder) return
    setLoadingOlder(true)
    const r = await getMessages({ conversationId: selectedId, before: msgCursor })
    if (r.ok) {
      setMessages((prev) => [...(r.items ?? []).map(toView), ...prev])
      setMsgCursor(r.nextCursor ?? null)
    }
    setLoadingOlder(false)
  }

  async function loadMoreConversations() {
    if (!convCursor || loadingMore) return
    setLoadingMore(true)
    const r = await listConversations({ cursor: convCursor })
    if (r.ok && r.items) {
      const items = r.items
      setConversations((prev) => [...prev, ...items])
      setConvCursor(r.nextCursor ?? null)
    }
    setLoadingMore(false)
  }

  async function handleRename(id: string, title: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    const r = await renameConversation(id, title)
    if (!r.ok) refreshConversations()
  }

  async function handleTogglePin(id: string) {
    const r = await togglePin(id)
    if (r.ok) refreshConversations()
  }

  async function handleDelete(id: string) {
    const conv = conversations.find((c) => c.id === id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (selectedId === id) {
      setSelectedId(null)
      setMessages([])
      setMsgCursor(null)
      setStreamDraft(null)
      updateUrl(null)
    }
    if (conv) {
      setRecentlyDeleted({ id, title: conv.title })
      if (deleteTimer.current) clearTimeout(deleteTimer.current)
      deleteTimer.current = setTimeout(() => setRecentlyDeleted(null), 5000)
    }
    const r = await softDeleteConversation(id)
    if (!r.ok) {
      setRecentlyDeleted(null)
      refreshConversations()
    }
  }

  async function handleRestore(id: string) {
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    setRecentlyDeleted(null)
    const r = await restoreConversation(id)
    if (r.ok) refreshConversations()
  }

  async function handleChangeModel(provider: AiChatProviderId, model: string) {
    if (selectedId) {
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, provider, model } : c)))
      const r = await updateConversationModel(selectedId, provider, model)
      if (!r.ok) refreshConversations()
    } else {
      const pv = providers.find((p) => p.id === provider) ?? {
        id: provider,
        label: PROVIDER_LABELS[provider],
        model,
      }
      setDraftProvider(pv)
    }
  }

  // 대화 없으면 지연 생성 후 id 반환(첨부·전송 공용)
  async function ensureConversation(): Promise<string | null> {
    if (selectedId) return selectedId
    const provider = curProvider
    const model = curModel
    if (!provider || !model) return null
    const r = await createConversation({ provider, model })
    if (!r.ok || !r.id) return null
    setSelectedId(r.id)
    updateUrl(r.id)
    void refreshConversations()
    return r.id
  }

  function makeUserMessage(convId: string, content: string, parentId: string | null): ChatMessageView {
    return {
      id: `temp-user-${crypto.randomUUID()}`,
      conversation_id: convId,
      role: 'user',
      content,
      thinking: null,
      provider: null,
      model: null,
      prompt_tokens: null,
      output_tokens: null,
      stopped: false,
      error: null,
      created_at: new Date().toISOString(),
      feedback: null,
      parent_message_id: parentId,
      attachments: [],
    }
  }

  function assistantFromDraft(
    convId: string,
    draft: StreamDraft,
    opts: { id: string; provider: string | null; model: string | null; stopped: boolean; error: string | null },
  ): ChatMessageView {
    return {
      id: opts.id,
      conversation_id: convId,
      role: 'assistant',
      content: draft.content,
      thinking: draft.thinking,
      provider: opts.provider,
      model: opts.model,
      prompt_tokens: null,
      output_tokens: null,
      stopped: opts.stopped,
      error: opts.error,
      created_at: new Date().toISOString(),
      feedback: null,
      parent_message_id: null,
      attachments: [],
    }
  }

  // 공용 스트림 실행 — mode별 낙관적 반영은 호출측이 선행, 여기선 SSE 소비만.
  async function runStream(
    body: StreamBody,
    reconcile: 'append' | 'reload',
    meta: { provider: string | null; model: string | null },
  ) {
    const convId = body.conversationId
    setStreamDraft({ role: 'assistant', content: '', thinking: null, streaming: true })
    const token = { done: false }
    activeSend.current = token

    await sse.send(body, {
      onDelta: (t) => {
        if (token.done) return
        setStreamDraft((d) => (d ? { ...d, content: d.content + t } : d))
      },
      onThinking: (t) => {
        if (token.done) return
        setStreamDraft((d) => (d ? { ...d, thinking: (d.thinking ?? '') + t } : d))
      },
      onDone: () => {
        if (token.done) return
        token.done = true
        if (reconcile === 'append') {
          setStreamDraft((d) => {
            if (d) {
              const asst = assistantFromDraft(convId, d, {
                id: `asst-${crypto.randomUUID()}`,
                provider: meta.provider,
                model: meta.model,
                stopped: false,
                error: null,
              })
              setMessages((prev) => [...prev, asst])
            }
            return null
          })
        } else {
          setStreamDraft(null)
        }
        void reloadMessages(convId)
        void refreshConversations()
      },
      onError: (msg) => {
        if (token.done) return
        token.done = true
        if (reconcile === 'reload') {
          // 재생성/편집 실패 — 서버가 이전 내용을 보존(재생성)하거나 error row를 남긴다(편집).
          // 재조회로 서버 진실을 복원(§5-1 "이전 내용 복원"). 낙관적으로 제거/절단한 상태를 되돌린다.
          setStreamDraft(null)
          void reloadMessages(convId)
          return
        }
        setStreamDraft((d) => {
          const draft: StreamDraft = d ?? { role: 'assistant', content: '', thinking: null, streaming: false }
          const asst = assistantFromDraft(convId, draft, {
            id: `err-${crypto.randomUUID()}`,
            provider: meta.provider,
            model: meta.model,
            stopped: false,
            error: msg,
          })
          setMessages((prev) => [...prev, asst])
          return null
        })
      },
    })
  }

  async function handleSend(content: string, attachmentIds: string[] = []) {
    if (sse.streaming) return
    const provider = curProvider
    const model = curModel
    if (!provider || !model) {
      setMsgError('사용 가능한 프로바이더가 없습니다. 설정에서 API 키를 등록하세요.')
      return
    }
    let convId = selectedId
    if (!convId) {
      convId = await ensureConversation()
      if (!convId) {
        setMsgError('대화 생성에 실패했습니다')
        return
      }
    }
    const finalConvId = convId
    setMessages((prev) => [...prev, makeUserMessage(finalConvId, content, null)])

    await runStream(
      {
        conversationId: finalConvId,
        mode: 'send',
        content,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      },
      'append',
      { provider, model },
    )
  }

  async function handleRegenerate() {
    if (sse.streaming || !selectedId) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const provider = curProvider
    const model = curModel
    if (!provider || !model) return
    // 마지막 assistant를 낙관적으로 비우고(제거) 재스트림 — 완료 시 서버가 치환한 결과를 재조회
    setMessages((prev) => prev.filter((m) => m.id !== last.id))
    await runStream({ conversationId: selectedId, mode: 'regenerate' }, 'reload', { provider, model })
  }

  async function handleEditSubmit(messageId: string, content: string, attachmentIds: string[]) {
    if (sse.streaming || !selectedId) return
    const provider = curProvider
    const model = curModel
    if (!provider || !model) return
    // 편집 = 편집 대상 위치에서 직접 절단 후 새 user 추가(불변식: messages == 활성 스레드).
    // 서버도 동일 결과(활성 스레드)를 반환하므로 reload 후에도 일관.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId)
      const head = idx >= 0 ? prev.slice(0, idx) : prev
      return [...head, makeUserMessage(selectedId, content, messageId)]
    })
    await runStream(
      {
        conversationId: selectedId,
        mode: 'edit',
        content,
        editedMessageId: messageId,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      },
      'reload',
      { provider, model },
    )
  }

  async function handleFeedback(messageId: string, value: 1 | -1 | null) {
    const snapshot = messages
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)))
    const r = await setMessageFeedback(messageId, value)
    if (!r.ok) setMessages(snapshot)
  }

  function handleStop() {
    sse.stop()
    const token = activeSend.current
    if (token && !token.done) {
      token.done = true
      const convId = selectedId ?? ''
      setStreamDraft((d) => {
        if (d) {
          const asst = assistantFromDraft(convId, d, {
            id: `stop-${crypto.randomUUID()}`,
            provider: curProvider,
            model: curModel,
            stopped: true,
            error: null,
          })
          setMessages((prev) => [...prev, asst])
        }
        return null
      })
      if (convId) void reloadMessages(convId)
      refreshConversations()
    }
  }

  function handleSystemPromptSave(value: string | null) {
    if (!selectedId) return
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, system_prompt: value } : c)))
  }

  return (
    <div className="ai-chat-layout">
      {sidebarOpen && (
        <div className="ai-chat-drawer-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside className="ai-chat-panel ai-chat-sidebar-panel" data-open={sidebarOpen} aria-label="대화 목록">
        <ConversationSidebar
          conversations={conversations}
          selectedId={selectedId}
          canCreate={canCreate}
          hasMore={!!convCursor}
          loadingMore={loadingMore}
          recentlyDeleted={recentlyDeleted}
          onSelect={selectConversation}
          onNewChat={newChat}
          onRename={handleRename}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onTogglePin={handleTogglePin}
          onLoadMore={loadMoreConversations}
        />
      </aside>

      <section className="ai-chat-panel" aria-label="채팅">
        <div className="ai-chat-topbar">
          <button
            type="button"
            className="ai-chat-icon-btn mobile-only"
            onClick={() => setSidebarOpen(true)}
            aria-label="대화 목록 열기"
          >
            <Menu size={18} />
          </button>
          <span className="ai-chat-topbar-title">{selectedConv?.title ?? '새 대화'}</span>
          {selectedConv && (
            <button
              type="button"
              className="ai-chat-icon-btn ai-chat-settings-btn"
              onClick={() => setSystemPromptOpen(true)}
              aria-label="시스템 프롬프트 설정"
              title="시스템 프롬프트"
            >
              <Settings2 size={18} />
              {selectedConv.system_prompt && <span className="ai-chat-settings-dot" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            className="ai-chat-icon-btn mobile-only"
            onClick={newChat}
            aria-label="새 대화"
          >
            <Plus size={18} />
          </button>
        </div>

        <MessageList
          messages={messages}
          streamDraft={streamDraft}
          loading={msgLoading}
          error={msgError}
          isStreaming={sse.streaming}
          thinkingText={streamDraft?.thinking ?? null}
          thinkingSupported={thinkingSupported}
          onRetry={retryLoad}
          hasOlder={!!msgCursor}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          onPromptClick={handleSend}
          onRegenerate={handleRegenerate}
          onEditSubmit={handleEditSubmit}
          onFeedback={handleFeedback}
        />

        <Composer
          streaming={sse.streaming}
          conversationId={selectedId}
          visionSupported={visionSupported}
          currentProvider={curProvider}
          currentModel={curModel}
          providers={providers}
          onSend={handleSend}
          onStop={handleStop}
          onChangeModel={handleChangeModel}
          ensureConversation={ensureConversation}
        />
      </section>

      {systemPromptOpen && selectedConv && (
        <SystemPromptModal
          conversationId={selectedConv.id}
          systemPrompt={selectedConv.system_prompt}
          onSave={handleSystemPromptSave}
          onClose={() => setSystemPromptOpen(false)}
        />
      )}
    </div>
  )
}
