// app/(ci)/ci/pipeline/page.tsx — P01 파이프라인 보드 (제작 기본 화면)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listIdeas } from '@/lib/ci/queries/ideas'
import { createAdminClient } from '@/lib/supabase/server'
import CiPageHeader from '@/components/ci/CiPageHeader'
import PipelineView from './PipelineView'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PipelinePage({
  searchParams,
}: { searchParams: Promise<{ from?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const ideas = await listIdeas(workspace.id)

  // 트렌드·홈에서 "아이디어 만들기"로 넘어온 경우, 근거로 삼을 콘텐츠 제목을 미리 채운다
  let seed: { contentId: string; title: string } | null = null
  if (sp.from) {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_contents')
      .select('id, title').eq('id', sp.from).eq('workspace_id', workspace.id)
      .is('deleted_at', null).maybeSingle()
    if (data) seed = { contentId: data.id, title: data.title ?? '' }
  }

  return (
    <>
      <CiPageHeader title="파이프라인" desc="아이디어에서 게시 준비까지" />
      <PipelineView workspaceId={workspace.id} ideas={ideas} seed={seed} />
    </>
  )
}
