import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/server'
import { getAvailableProviders, getDefaultProvider, getProvider } from '@/lib/ai-chat/registry'
import type { AiChatProviderId } from '@/types/database'
import { listConversations, getMessages } from './actions'
import AiChatClient, { PROVIDER_LABELS, type ProviderView, type ProviderCaps } from './AiChatClient'

const ALL_PROVIDER_IDS: AiChatProviderId[] = ['gemini', 'claude', 'openai']

export default async function AiChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  // admin/layout에서 이미 게이팅 — 페이지 이중검증 컨벤션
  await requireAdmin()

  const params = await searchParams
  const conversationId = params.c ?? null

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaData } = await (adminClient as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()
  const meta = (metaData?.value as Record<string, unknown>) ?? {}

  // 가용 프로바이더 — API 키는 서버 전용, 클라엔 {id,label,model}만 전달
  const providers: ProviderView[] = getAvailableProviders(meta).map((p) => ({
    id: p.id,
    label: PROVIDER_LABELS[p.id],
    model: p.model,
  }))
  const def = getDefaultProvider(meta)
  const defaultProvider = def ? { id: def.id, model: def.model } : null

  // 프로바이더별 capability(vision·thinking) — 현재 대화 provider 기준으로 Composer/MessageBubble 배선
  const capabilities = ALL_PROVIDER_IDS.reduce((acc, id) => {
    const caps = getProvider(id).capabilities
    acc[id] = { vision: caps.vision, thinking: caps.thinking }
    return acc
  }, {} as Record<AiChatProviderId, ProviderCaps>)

  // 초기 데이터 병렬 로드
  const [convRes, msgRes] = await Promise.all([
    listConversations({}),
    conversationId ? getMessages({ conversationId }) : Promise.resolve(null),
  ])

  const initialConversations = convRes.ok && convRes.items ? convRes.items : []
  const initialCursor = convRes.ok ? convRes.nextCursor ?? null : null
  const initialMessages = msgRes && msgRes.ok && msgRes.items ? msgRes.items : []
  const initialMsgCursor = msgRes && msgRes.ok ? msgRes.nextCursor ?? null : null

  return (
    <AiChatClient
      initialConversations={initialConversations}
      initialCursor={initialCursor}
      initialMessages={initialMessages}
      initialMsgCursor={initialMsgCursor}
      initialConversationId={conversationId}
      providers={providers}
      defaultProvider={defaultProvider}
      capabilities={capabilities}
    />
  )
}
