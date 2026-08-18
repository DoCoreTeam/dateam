// app/(ci)/ci/pipeline/page.tsx — P01 파이프라인 보드 (제작 기본 화면)
import { redirect } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listIdeas } from '@/lib/ci/queries/ideas'
import { createAdminClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import PipelineView from './PipelineView'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PipelinePage({
  searchParams,
}: { searchParams: Promise<{ from?: string }> }) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const ideas = await listIdeas(workspace.id)

  // 트렌드·홈에서 "아이디어 만들기"로 넘어온 경우, 근거로 삼을 콘텐츠를 미리 채운다.
  //
  // 제목만 넘기면 사용자는 빈 화면 앞에서 다시 생각해야 한다.
  // 영상을 읽어 뒀다면 **왜 통했고 어떻게 따라 만드는지**를 이미 알고 있으므로 함께 넘긴다 —
  // 이것이 "영상을 읽는다"가 기획으로 이어지는 지점이다.
  let seed: {
    contentId: string
    title: string
    formula?: string | null
    whyItWorks?: string | null
    hookMessage?: string | null
  } | null = null
  if (sp.from) {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_contents')
      .select('id, title').eq('id', sp.from).eq('workspace_id', workspace.id)
      .is('deleted_at', null).maybeSingle()
    if (data) {
      const { data: media } = await adminClient.from('ci_content_media')
        .select('replicable_formula, why_it_works, hook_message')
        .eq('content_id', data.id).maybeSingle()
      seed = {
        contentId: data.id,
        title: data.title ?? '',
        formula: media?.replicable_formula ?? null,
        whyItWorks: media?.why_it_works ?? null,
        hookMessage: media?.hook_message ?? null,
      }
    }
  }

  return (
    <>
      <PageHeader title="파이프라인" description="아이디어에서 게시 준비까지" />
      <PipelineView workspaceId={workspace.id} ideas={ideas} seed={seed} />
    </>
  )
}
