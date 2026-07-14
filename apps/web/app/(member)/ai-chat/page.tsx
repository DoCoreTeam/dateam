import { requireAdmin } from '@/lib/auth/requireAdmin'
import { loadAiChatPageData } from '@/app/admin/ai-chat/load'
import AiChatClient from '@/app/admin/ai-chat/AiChatClient'

// AI 채팅 — 일반 앱(member) 라우트, admin 전용 게이트 유지(§③).
// 서버 데이터로딩은 admin/ai-chat/load.ts(SSOT)를 공유해 구 /admin/ai-chat 경로와 동일하게 재사용.
// 렌더 컴포넌트(AiChatClient 등)도 기존 app/admin/ai-chat/에서 그대로 import(이동 아님).
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
