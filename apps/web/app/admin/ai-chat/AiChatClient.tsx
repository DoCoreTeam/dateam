'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Plus } from 'lucide-react'
import type { AiChatConversation, AiChatMessage, AiChatProviderId } from '@/types/database'
import { useSseChat } from '@/lib/ai-chat/use-sse-chat'
import {
  createConversation,
  listConversations,
  getMessages,
  renameConversation,
  togglePin,
  updateConversationModel,
  softDeleteConversation,
  restoreConversation,
} from './actions'
import ConversationSidebar from './ConversationSidebar'
import MessageList from './MessageList'
import Composer from './Composer'
import type { StreamDraft } from './MessageBubble'

// ── 클라이언트 공용 뷰 타입 (API 키는 서버 전용 — 클라엔 라벨/모델만) ──
export interface ProviderView {
  id: AiChatProviderId
  label: string
  model: string
}

export const PROVIDER_LABELS: Record<AiChatProviderId, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
}

interface AiChatClientProps {
  initialConversations: AiChatConversation[]
  initialCursor: string | null
  initialMessages: AiChatMessage[]
  initialMsgCursor: string | null
  initialConversationId: string | null
  providers: ProviderView[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
}

export default function AiChatClient({
  initialConversations,
  initialCursor,
  initialMessages,
  initialMsgCursor,
  initialConversationId,
  providers,
  defaultProvider,
}: AiChatClientProps) {
  const router = useRouter()
  const sse = useSseChat()

  const [conversations, setConversations] = useState<AiChatConversation[]>(initialConversations)
  const [convCursor, setConvCursor] = useState<string | null>(initialCursor)
  const [loadingMore, setLoadingMore] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<AiChatMessage[]>(initialMessages)
  const [msgCursor, setMsgCursor] = useState<string | null>(initialMsgCursor)
  const [msgLoading, setMsgLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)

  const [streamDraft, setStreamDraft] = useState<StreamDraft | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [recentlyDeleted, setRecentlyDeleted] = useState<{ id: string; title: string } | null>(null)

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
      setMessages(r.items ?? [])
      setMsgCursor(r.nextCursor ?? null)
    } else {
      setMsgError(r.error ?? '메시지를 불러오지 못했습니다')
    }
    setMsgLoading(false)
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
      setMessages((prev) => [...(r.items ?? []), ...prev])
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

  async function handleSend(content: string) {
    if (sse.streaming) return
    const provider = curProvider
    const model = curModel
    if (!provider || !model) {
      setMsgError('사용 가능한 프로바이더가 없습니다. 설정에서 API 키를 등록하세요.')
      return
    }

    let convId = selectedId
    // 대화 없으면 첫 전송 시 지연 생성
    if (!convId) {
      const r = await createConversation({ provider, model })
      if (!r.ok || !r.id) {
        setMsgError(r.error ?? '대화 생성에 실패했습니다')
        return
      }
      convId = r.id
      setSelectedId(convId)
      updateUrl(convId)
      refreshConversations()
    }

    const finalConvId = convId

    const tempUser: AiChatMessage = {
      id: `temp-user-${Date.now()}`,
      conversation_id: finalConvId,
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
    }
    setMessages((prev) => [...prev, tempUser])
    setStreamDraft({ role: 'assistant', content: '', thinking: null, streaming: true })

    const token = { done: false }
    activeSend.current = token

    await sse.send(
      { conversationId: finalConvId, content },
      {
        onDelta: (t) => {
          if (token.done) return
          setStreamDraft((d) => (d ? { ...d, content: d.content + t } : d))
        },
        onThinking: (t) => {
          if (token.done) return
          setStreamDraft((d) => (d ? { ...d, thinking: (d.thinking ?? '') + t } : d))
        },
        onDone: ({ messageId }) => {
          if (token.done) return
          token.done = true
          setStreamDraft((d) => {
            if (d) {
              const asst: AiChatMessage = {
                id: messageId,
                conversation_id: finalConvId,
                role: 'assistant',
                content: d.content,
                thinking: d.thinking,
                provider,
                model,
                prompt_tokens: null,
                output_tokens: null,
                stopped: false,
                error: null,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, asst])
            }
            return null
          })
          refreshConversations()
        },
        onError: (msg) => {
          if (token.done) return
          token.done = true
          setStreamDraft((d) => {
            if (d) {
              const asst: AiChatMessage = {
                id: `err-${Date.now()}`,
                conversation_id: finalConvId,
                role: 'assistant',
                content: d.content,
                thinking: d.thinking,
                provider,
                model,
                prompt_tokens: null,
                output_tokens: null,
                stopped: false,
                error: msg,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, asst])
            }
            return null
          })
        },
      },
    )
  }

  function handleStop() {
    sse.stop()
    const token = activeSend.current
    if (token && !token.done) {
      token.done = true
      setStreamDraft((d) => {
        if (d) {
          const asst: AiChatMessage = {
            id: `stop-${Date.now()}`,
            conversation_id: selectedId ?? '',
            role: 'assistant',
            content: d.content,
            thinking: d.thinking,
            provider: curProvider,
            model: curModel,
            prompt_tokens: null,
            output_tokens: null,
            stopped: true,
            error: null,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, asst])
        }
        return null
      })
      refreshConversations()
    }
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
          onRetry={retryLoad}
          hasOlder={!!msgCursor}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          onPromptClick={handleSend}
        />

        <Composer
          streaming={sse.streaming}
          currentProvider={curProvider}
          currentModel={curModel}
          providers={providers}
          onSend={handleSend}
          onStop={handleStop}
          onChangeModel={handleChangeModel}
        />
      </section>
    </div>
  )
}
