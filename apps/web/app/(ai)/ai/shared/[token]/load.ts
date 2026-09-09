// 공유 대화(read-only) 데이터로딩 SSOT — admin(/admin/ai-chat/shared/[token], redirect 전용)과
// member(/ai-chat/shared/[token]) 양쪽 서버 페이지가 동일 로직을 재사용(복붙 금지).
import { createAdminClient } from '@/lib/supabase/server'
import type { AiChatCitation } from '@/types/database'

export interface SharedConversation {
  id: string
  user_id: string
  title: string
  provider: string
  model: string
  created_at: string
}

export interface SharedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  citations: AiChatCitation[] | null
}

export interface SharedConversationData {
  conversation: SharedConversation
  messages: SharedMessage[]
  ownerName: string
}

export async function loadSharedConversationData(token: string): Promise<SharedConversationData | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 공유 대화 조회 — 반드시 shared=true AND share_token 일치 AND 미삭제만
  const { data: conv } = await db
    .from('ai_conversations')
    .select('id, user_id, title, provider, model, created_at')
    .eq('share_token', token)
    .eq('shared', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!conv) return null

  const c = conv as SharedConversation

  const [msgRes, ownerRes] = await Promise.all([
    db
      .from('ai_messages')
      .select('id, role, content, created_at, citations')
      .eq('conversation_id', c.id)
      .is('error', null)
      .order('created_at', { ascending: true }),
    db
      .from('profiles')
      .select('name')
      .eq('id', c.user_id)
      .maybeSingle(),
  ])

  const messages = (Array.isArray(msgRes?.data) ? msgRes.data : []) as SharedMessage[]
  const ownerName = (ownerRes?.data?.name as string | undefined)?.trim() || '알 수 없는 사용자'

  return { conversation: c, messages, ownerName }
}
