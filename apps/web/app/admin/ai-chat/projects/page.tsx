import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'

// AI 채팅 프로젝트 목록은 일반 앱(member)으로 이동됨(§③) — 기존 /admin/ai-chat/projects 링크 호환을 위해 리다이렉트만 유지.
export default async function AiChatProjectsAdminRedirectPage() {
  await requireAdmin()
  redirect('/ai-chat/projects')
}
