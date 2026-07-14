'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Plus, Settings2, Share2, Download, Copy, Check, ArrowLeftToLine } from 'lucide-react'
import type {
  AiChatConversation,
  AiChatMessage,
  AiChatProviderId,
  AiChatProject,
} from '@/types/database'
import { useSseChat, type StreamBody } from '@/lib/ai-chat/use-sse-chat'
import { buildArtifactVersions } from '@/lib/ai-chat/artifacts'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
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
  listProjects,
  setConversationProject,
  toggleShare,
  type BranchMeta,
} from './actions'
import ConversationSidebar from './ConversationSidebar'
import MessageList from './MessageList'
import Composer from './Composer'
import SystemPromptModal from './SystemPromptModal'
import ArtifactPanel, { type ArtifactVersionEntry } from './ArtifactPanel'
import NbBadge from '@/components/ui/nb/NbBadge'
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
  tools: boolean
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

/** 화면용 메시지 = 영속 메시지 + 세션2 필드(feedback·parent·attachments) + 세션3 분기 메타. */
export interface ChatMessageView extends AiChatMessage {
  feedback: -1 | 1 | null
  parent_message_id: string | null
  attachments: AttachmentView[]
  branch?: BranchMeta
}

// PROVIDER_LABELS는 lib/ai-chat/labels.ts(SSOT)에서 import — 'use client'에서 정의·export하면 서버
// 컴포넌트(page.tsx)가 import할 때 RSC 매니페스트 오류가 난다. 아래 컴포넌트들은 labels에서 직접 import.

// 서버가 세션2 필드를 아직 실을 수도/안 실을 수도 있어 관대하게 승격(병행 개발 안전).
type RawMessage = AiChatMessage &
  Partial<{
    feedback: -1 | 1 | null
    parent_message_id: string | null
    attachments: AttachmentView[]
    branch: BranchMeta
  }>

function toView(m: AiChatMessage): ChatMessageView {
  const r = m as RawMessage
  return {
    ...m,
    feedback: r.feedback ?? null,
    parent_message_id: r.parent_message_id ?? null,
    attachments: r.attachments ?? [],
    branch: r.branch,
  }
}

// URL `b=` ↔ choices(rootId→versionId) 직렬화 (S3 §5-5). rootId/versionId=UUID → '.'·',' 안전.
function choicesToParam(ch: Record<string, string>): string {
  return Object.entries(ch)
    .map(([root, ver]) => `${root}.${ver}`)
    .join(',')
}
function parseBranchParam(b: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of b.split(',')) {
    const dot = pair.indexOf('.')
    if (dot > 0) out[pair.slice(0, dot)] = pair.slice(dot + 1)
  }
  return out
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

  // ── 세션3 허브 상태 ──
  const [webSearch, setWebSearch] = useState(false)
  const [toolSearching, setToolSearching] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<{ identity: string; versionIndex: number } | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [projects, setProjects] = useState<AiChatProject[]>([])
  const [shareCopied, setShareCopied] = useState(false)

  const activeSend = useRef<{ done: boolean } | null>(null)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current)
    }
  }, [])

  // 프로젝트 목록 1회 로드(헤더 select·사이드바 뱃지 공용)
  useEffect(() => {
    listProjects().then((r) => {
      if (r.ok && r.items) setProjects(r.items)
    })
  }, [])

  // 최초 진입 시 URL의 b=(열람 분기) 복원 — 활성 스레드로 로드된 뒤 choices 반영해 재조회
  useEffect(() => {
    if (!initialConversationId) return
    const b = new URLSearchParams(window.location.search).get('b')
    const parsed = b ? parseBranchParam(b) : {}
    if (Object.keys(parsed).length > 0) {
      setChoices(parsed)
      void loadMessagesWithChoices(initialConversationId, parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null
  const curProvider: AiChatProviderId | null = selectedConv?.provider ?? draftProvider?.id ?? null
  const curModel: string | null = selectedConv?.model ?? draftProvider?.model ?? null
  const canCreate = providers.length > 0
  const visionSupported = curProvider ? capabilities[curProvider].vision : false
  const thinkingSupported = curProvider ? capabilities[curProvider].thinking : false
  const toolsSupported = curProvider ? capabilities[curProvider].tools : false

  // 과거(비활성) 분기 열람 중 = 표시 버전이 그룹 최신이 아님(활성 스레드는 index===count 불변).
  const viewingPast = messages.some((m) => m.branch && m.branch.index < m.branch.count)

  // artifact 버전 맵 — 영속 assistant 메시지에서만 파생(스트리밍 중 파싱 금지, §2-3). identity별 버전 시퀀스.
  const artifactVersions = useMemo(() => {
    const asst = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => ({ id: m.id, content: m.content, createdAt: m.created_at }))
    return buildArtifactVersions(asst)
  }, [messages])
  const activeArtifactVersions: ArtifactVersionEntry[] | null = activeArtifact
    ? artifactVersions.get(activeArtifact.identity) ?? null
    : null

  const shareToken = selectedConv?.share_token ?? null
  const isShared = !!selectedConv?.shared && !!shareToken
  const shareUrl = isShared ? `/admin/ai-chat/shared/${shareToken}` : null

  // `messages`는 항상 "활성 스레드"를 직접 보유한다(불변식):
  //  - 서버(getMessages)가 이미 buildActiveThread 적용본을 반환 → 그대로 사용(재적용 금지: 재적용 시
  //    편집 메시지의 parent가 이미 절단돼 idx<0으로 skip되어 편집 질문이 사라짐 — 이중적용 버그).
  //  - 낙관적 편집은 편집 대상 인덱스에서 직접 절단해 불변식을 유지(handleEditSubmit).

  function updateUrl(id: string | null, ch: Record<string, string> = {}) {
    const params = new URLSearchParams()
    if (id) params.set('c', id)
    const b = choicesToParam(ch)
    if (b) params.set('b', b)
    const qs = params.toString()
    router.replace(qs ? `/admin/ai-chat?${qs}` : '/admin/ai-chat', { scroll: false })
  }

  // 선택 버전(choices) 기준 열람 스레드 조회 — 분기 전환·URL 복원 공용
  async function loadMessagesWithChoices(id: string, ch: Record<string, string>) {
    const r = await getMessages({ conversationId: id, choices: ch })
    if (r.ok) {
      setMessages((r.items ?? []).map(toView))
      setMsgCursor(r.nextCursor ?? null)
    }
  }

  async function refreshConversations() {
    const r = await listConversations({})
    if (r.ok && r.items) {
      setConversations(r.items)
      setConvCursor(r.nextCursor ?? null)
    }
  }

  // 첫 메시지 제목 경합 대응: 서버 autoTitle은 fire-and-forget(별도 Gemini 호출)이라 스트림 done 시점엔
  // 아직 '새 대화'다. 해당 대화 제목이 기본값을 벗어날 때까지 몇 번 재조회해 사이드바에 실시간 반영한다.
  async function refreshConversationsUntilTitled(convId: string, tries = 5) {
    for (let i = 0; i < tries; i++) {
      const r = await listConversations({})
      if (r.ok && r.items) {
        setConversations(r.items)
        setConvCursor(r.nextCursor ?? null)
        const title = r.items.find((c) => c.id === convId)?.title
        if (title && title !== '새 대화') return   // 제목 확정됨 → 종료
      }
      await new Promise((res) => setTimeout(res, 1200))
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
    setChoices({})
    setActiveArtifact(null)
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
    setChoices({})
    setActiveArtifact(null)
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
      citations: null,
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
      citations: null,
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
    setToolSearching(false)
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
      onToolStatus: (s) => {
        if (token.done) return
        setToolSearching(s === 'searching')
      },
      onDone: () => {
        if (token.done) return
        token.done = true
        setToolSearching(false)
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
        void refreshConversationsUntilTitled(convId)   // 제목 경합 대응(첫 메시지 후 실시간 반영)
      },
      onError: (msg) => {
        if (token.done) return
        token.done = true
        setToolSearching(false)
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
        tools: webSearch && toolsSupported ? { webSearch: true } : undefined,
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

  // ── S3 §5-5: 분기 전환 / 최신 복귀 ──
  async function handleBranchNav(rootId: string, versionId: string) {
    if (!selectedId || sse.streaming) return
    const next = { ...choices, [rootId]: versionId }
    setChoices(next)
    setActiveArtifact(null)
    updateUrl(selectedId, next)
    await loadMessagesWithChoices(selectedId, next)
  }

  async function backToLatest() {
    if (!selectedId) return
    setChoices({})
    setActiveArtifact(null)
    updateUrl(selectedId, {})
    await loadMessagesWithChoices(selectedId, {})
  }

  // ── S3 §3: 대화-프로젝트 연결 ──
  async function handleSetProject(projectId: string | null) {
    if (!selectedId) return
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, project_id: projectId } : c)),
    )
    const r = await setConversationProject(selectedId, projectId)
    if (!r.ok) refreshConversations()
  }

  // ── S3 §5-2: 공유 옵트인 토글 ──
  async function handleToggleShare() {
    if (!selectedId) return
    const turnOn = !isShared
    const r = await toggleShare(selectedId, turnOn)
    if (r.ok) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, shared: turnOn, share_token: r.token ?? null } : c,
        ),
      )
    } else {
      refreshConversations()
    }
  }

  function copyShareUrl() {
    if (!shareUrl) return
    const abs = `${window.location.origin}${shareUrl}`
    navigator.clipboard.writeText(abs).then(
      () => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 1500)
      },
      () => {},
    )
  }

  // ── S3 §5-1: Markdown 내보내기 (첨부 다운로드) ──
  function handleExport() {
    if (!selectedId) return
    window.open(`/api/admin/ai-chat/export?c=${selectedId}`, '_blank', 'noopener,noreferrer')
  }

  // ── S3 §2-3: artifact 패널 오픈(최신 버전으로) ──
  function handleOpenArtifact(identity: string) {
    const versions = artifactVersions.get(identity)
    const last = versions ? versions.length - 1 : 0
    setActiveArtifact({ identity, versionIndex: Math.max(0, last) })
  }

  return (
    <div className="ai-chat-layout" data-artifact={activeArtifactVersions ? 'true' : undefined}>
      {sidebarOpen && (
        <div className="ai-chat-drawer-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside className="ai-chat-panel ai-chat-sidebar-panel" data-open={sidebarOpen} aria-label="대화 목록">
        <ConversationSidebar
          conversations={conversations}
          projects={projects}
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
            <div className="ai-chat-topbar-actions">
              <select
                className="input-field ai-chat-project-select"
                value={selectedConv.project_id ?? ''}
                onChange={(e) => handleSetProject(e.target.value || null)}
                aria-label="프로젝트 연결"
                title="프로젝트 연결"
              >
                <option value="">프로젝트 없음</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ai-chat-icon-btn"
                data-active={isShared}
                onClick={handleToggleShare}
                aria-label={isShared ? '공유 해제' : '공유하기'}
                aria-pressed={isShared}
                title={isShared ? '공유 해제' : '공유하기'}
              >
                <Share2 size={18} />
              </button>
              <button
                type="button"
                className="ai-chat-icon-btn"
                onClick={handleExport}
                aria-label="내보내기 (.md)"
                title="내보내기 (.md)"
              >
                <Download size={18} />
              </button>
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
            </div>
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

        {isShared && shareUrl && (
          <div className="ai-chat-share-bar" role="status">
            <NbBadge>공유됨</NbBadge>
            <span className="ai-chat-share-url" title={shareUrl}>
              {shareUrl}
            </span>
            <button type="button" className="ai-chat-copy-btn" onClick={copyShareUrl} aria-label="공유 링크 복사">
              {shareCopied ? <Check size={12} /> : <Copy size={12} />}
              {shareCopied ? '복사됨' : '링크 복사'}
            </button>
          </div>
        )}

        {viewingPast && (
          <div className="ai-chat-banner ai-chat-branch-banner" data-tone="neutral" role="status">
            <span>과거 분기 열람 중 — 이어쓰려면 최신 분기로 돌아가세요</span>
            <button
              type="button"
              className="ai-chat-copy-btn"
              onClick={backToLatest}
              style={{ color: 'var(--brand)', fontWeight: 700, flexShrink: 0 }}
            >
              <ArrowLeftToLine size={12} />
              최신 분기로
            </button>
          </div>
        )}

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
          onOpenArtifact={handleOpenArtifact}
          onBranchNav={handleBranchNav}
          locked={viewingPast}
          webSearching={toolSearching && sse.streaming}
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
          toolsSupported={toolsSupported}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch((v) => !v)}
          locked={viewingPast}
        />
      </section>

      {activeArtifactVersions && activeArtifact && (
        <ArtifactPanel
          versions={activeArtifactVersions}
          versionIndex={activeArtifact.versionIndex}
          onClose={() => setActiveArtifact(null)}
          onVersionChange={(i) => setActiveArtifact((a) => (a ? { ...a, versionIndex: i } : a))}
        />
      )}

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
