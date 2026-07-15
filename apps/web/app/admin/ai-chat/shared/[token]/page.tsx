import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'

// 공유 대화(read-only) 뷰는 일반 앱(member)으로 이동됨(§③) — 기존 /admin/ai-chat/shared/[token] 링크 호환을 위해 리다이렉트만 유지.
export default async function SharedConversationAdminRedirectPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await requireAdmin()
  const { token } = await params
  redirect(`/ai-chat/shared/${token}`)
}
