// app/(ci)/ci/monitoring/page.tsx — R02 모니터링 (관심 채널)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listChannels } from '@/lib/ci/queries/channels'
import CiPageHeader from '@/components/ci/CiPageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ChannelListView from '@/components/ci/ChannelListView'

export const dynamic = 'force-dynamic'

export default async function MonitoringPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const items = await listChannels(workspace.id, 'tracked')

  return (
    <>
      <CiPageHeader
        title="모니터링"
        desc="지켜볼 채널을 등록하면 새 게시물과 성과 변화를 따라갑니다"
        stageNav={<StageNav stages={RESEARCH_STAGES} />}
      />
      <ChannelListView workspaceId={workspace.id} items={items} mode="tracked" />
    </>
  )
}
