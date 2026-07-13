import { requireAdmin } from '@/lib/auth/requireAdmin'
import { listProjects } from '../actions'
import ProjectsClient from './ProjectsClient'

// 프로젝트 목록 (서버) — admin/layout 게이팅 후 페이지 이중검증 컨벤션
export default async function AiChatProjectsPage() {
  await requireAdmin()

  const res = await listProjects()
  const initialProjects = res.ok && res.items ? res.items : []

  return <ProjectsClient initialProjects={initialProjects} />
}
