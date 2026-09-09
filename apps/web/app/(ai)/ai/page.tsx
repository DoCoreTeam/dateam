import { requireAdmin } from '@/lib/auth/requireAdmin'
import { loadAiChatPageData } from '@/app/(ai)/ai/load'
import AiChatClient from '@/app/(ai)/ai/AiChatClient'

// AI 채팅 — AI 스튜디오의 첫 화면, admin 전용 게이트 유지(§③).
// 옛 주소 /ai-chat 과 /admin/ai-chat 은 next.config 리다이렉트로 여기로 온다.
export default async function AiChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()

  const params = await searchParams
  const conversationId = params.c ?? null

  const data = await loadAiChatPageData(conversationId)

  return (
    <AiChatClient
      initialConversations={data.initialConversations}
      initialCursor={data.initialCursor}
      initialMessages={data.initialMessages}
      initialMsgCursor={data.initialMsgCursor}
      initialConversationId={conversationId}
      providers={data.providers}
      defaultProvider={data.defaultProvider}
      capabilities={data.capabilities}
    />
  )
}
