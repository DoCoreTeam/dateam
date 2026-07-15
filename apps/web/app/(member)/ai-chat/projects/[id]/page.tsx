import { loadProjectDetailData } from '@/app/admin/ai-chat/projects/[id]/load'
import ProjectDetailClient from '@/app/admin/ai-chat/projects/[id]/ProjectDetailClient'

// 프로젝트 상세 — 일반 앱(member) 라우트, admin 전용 게이트 유지(§③).
// 서버 데이터로딩은 admin/ai-chat/projects/[id]/load.ts(SSOT)를 공유해 구 /admin/ai-chat 경로와 동일하게 재사용.
// 렌더 컴포넌트(ProjectDetailClient)도 기존 app/admin/ai-chat/projects/[id]/에서 그대로 import(이동 아님).
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await loadProjectDetailData(id)

  return (
    <ProjectDetailClient
      project={data.project}
      initialKnowledge={data.initialKnowledge}
      conversations={data.conversations}
      defaultProvider={data.defaultProvider}
    />
  )
}
