import { requireAdmin } from '@/lib/auth/requireAdmin'
import { listProjects } from '@/app/admin/ai-chat/actions'
import ProjectsClient from '@/app/admin/ai-chat/projects/ProjectsClient'

// 프로젝트 목록 — 일반 앱(member) 라우트, admin 전용 게이트 유지(§③).
// 서버 액션(listProjects)과 클라이언트 컴포넌트(ProjectsClient)는 기존 app/admin/ai-chat/에서 그대로 import(이동 아님).
export default async function AiChatProjectsPage() {
  await requireAdmin()

  const res = await listProjects()
  const initialProjects = res.ok && res.items ? res.items : []

  return <ProjectsClient initialProjects={initialProjects} />
}
