// 프로젝트 상세 페이지 데이터로딩 SSOT — admin(/admin/ai-chat/projects/[id], redirect 전용)과
// member(/ai-chat/projects/[id]) 양쪽 서버 페이지가 동일 로직을 재사용(복붙 금지).
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getDefaultProvider } from '@/lib/ai-chat/registry'
import type { AiChatProject, AiChatProviderId } from '@/types/database'
import { listKnowledge } from '../../actions'
import type { ProjectConversation } from './ProjectDetailClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

interface KnowledgeItem {
  source: string
  chunks: number
  createdAt: string
}

export interface ProjectDetailPageData {
  project: AiChatProject
  initialKnowledge: KnowledgeItem[]
  conversations: ProjectConversation[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
}

export async function loadProjectDetailData(id: string): Promise<ProjectDetailPageData> {
  // 권한 게이트 + userId 확보(소유 스코프 쿼리에 필요 — requireAdmin은 user를 반환하지 않음)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin: AdminClient = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  // 프로젝트 — owner 스코프 직접 조회(listProjects find 대신 단건 조회)
  const { data: projectRow } = await admin
    .from('ai_projects')
    .select('id, user_id, name, instructions, created_at, updated_at, deleted_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!projectRow) redirect('/ai-chat/projects')
  const project = projectRow as AiChatProject

  // 이 프로젝트의 대화 — listConversations는 project_id 필터를 지원하지 않으므로
  // owner 스코프 직접 조회로 project_id 필터.
  const [knowledgeRes, convResult, metaResult] = await Promise.all([
    listKnowledge(id),
    admin
      .from('ai_conversations')
      .select('id, title, provider, model, updated_at')
      .eq('user_id', user.id)
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    admin.from('org_content').select('value').eq('key', 'META').single(),
  ])

  const initialKnowledge = knowledgeRes.ok && knowledgeRes.items ? knowledgeRes.items : []
  const conversations = (convResult.data ?? []) as ProjectConversation[]

  const meta = (metaResult.data?.value as Record<string, unknown>) ?? {}
  const def = getDefaultProvider(meta)
  const defaultProvider = def ? { id: def.id, model: def.model } : null

  return { project, initialKnowledge, conversations, defaultProvider }
}
