// AI 스튜디오 서버 데이터 로딩 SSOT — 채팅 화면과 모델 화면이 같은 읽기를 공유한다(복붙 금지).
import { createAdminClient } from '@/lib/supabase/server'
import { getAvailableProviders, getDefaultProvider, getProvider, isWired } from '@/lib/ai-chat/registry'
import { AI_PROVIDER_IDS } from '@/lib/ai/provider-catalog'
import type { AiChatProviderId, AiChatConversation } from '@/types/database'
import { listConversations, getMessages, type MessageWithAttachments } from './actions'
import type { ProviderView, ProviderCaps } from './AiChatClient'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'

/**
 * 능력을 실어 보낼 공급자 목록 — **명세에서 온다**(lib/ai/provider-catalog).
 *
 * 예전엔 여기에 `['gemini','claude','openai']` 를 손으로 적어 뒀다. 그 사이 공급자가
 * 다섯으로 늘었는데 이 줄만 셋에 멈춰 있었고, **Groq 모델을 고르는 순간 화면이 통째로 죽었다**
 * (실측 v0.7.716: `capabilities['groq']` 가 undefined 라 `.vision` 을 읽다 던졌다).
 * 목록을 손으로 적으면 공급자를 늘릴 때 여기만 안 고쳐진다.
 */
// 어댑터가 배선된 것만 — `getProvider` 는 배선 안 된 공급자에 **예외를 던진다.**
// 명세에 이름만 올라간 공급자(배선 예정)가 하나 생기면 그 순간 화면이 통째로 죽는다.
const ALL_PROVIDER_IDS: AiChatProviderId[] = AI_PROVIDER_IDS.filter(isWired)

export interface AiChatPageData {
  initialConversations: AiChatConversation[]
  initialCursor: string | null
  initialMessages: MessageWithAttachments[]
  initialMsgCursor: string | null
  providers: ProviderView[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
  capabilities: Record<AiChatProviderId, ProviderCaps>
}

/** 어느 공급자를 쓸 수 있고 무엇을 할 수 있는가 — 채팅과 모델 화면이 같이 읽는다 */
export interface AiProvidersData {
  providers: ProviderView[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
  capabilities: Record<AiChatProviderId, ProviderCaps>
}

/**
 * 키가 설정된 공급자와 그 능력만 읽는다(대화는 안 읽는다).
 *
 * 모델 화면은 대화를 하나도 필요로 하지 않는다. 채팅용 로더를 그대로 부르면
 * 목록 조회 두 번이 그냥 버려진다 — 그래서 읽기를 이 크기로 잘라 둔다.
 */
export async function loadAiProviders(): Promise<AiProvidersData> {
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
    acc[id] = { vision: caps.vision, thinking: caps.thinking, tools: caps.tools }
    return acc
  }, {} as Record<AiChatProviderId, ProviderCaps>)

  return { providers, defaultProvider, capabilities }
}

export async function loadAiChatPageData(conversationId: string | null): Promise<AiChatPageData> {
  const { providers, defaultProvider, capabilities } = await loadAiProviders()

  // 초기 데이터 병렬 로드
  const [convRes, msgRes] = await Promise.all([
    listConversations({}),
    conversationId ? getMessages({ conversationId }) : Promise.resolve(null),
  ])

  const initialConversations = convRes.ok && convRes.items ? convRes.items : []
  const initialCursor = convRes.ok ? convRes.nextCursor ?? null : null
  const initialMessages = msgRes && msgRes.ok && msgRes.items ? msgRes.items : []
  const initialMsgCursor = msgRes && msgRes.ok ? msgRes.nextCursor ?? null : null

  return {
    initialConversations,
    initialCursor,
    initialMessages,
    initialMsgCursor,
    providers,
    defaultProvider,
    capabilities,
  }
}
