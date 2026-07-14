import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'

// AI 채팅은 일반 앱(member)으로 이동됨(§③) — 기존 /admin/ai-chat 링크 호환을 위해 리다이렉트만 유지.
// 쿼리스트링(대화 id `c`, 분기 `b`)도 그대로 전달해 딥링크가 깨지지 않게 한다.
export default async function AiChatAdminRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()

  const params = await searchParams
  const qs = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  ).toString()
  redirect(qs ? `/ai-chat?${qs}` : '/ai-chat')
}
