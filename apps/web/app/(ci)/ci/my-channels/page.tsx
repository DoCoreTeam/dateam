// app/(ci)/ci/my-channels/page.tsx — B02 내 채널
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listChannels } from '@/lib/ci/queries/channels'
import CiPageHeader from '@/components/ci/CiPageHeader'
import ChannelListView from '@/components/ci/ChannelListView'

export const dynamic = 'force-dynamic'

export default async function MyChannelsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const items = await listChannels(workspace.id, 'owned')

  return (
    <>
      <CiPageHeader
        title="내 채널"
        desc="내가 운영하는 채널입니다. 게시와 성과 추적의 기준이 됩니다"
      />
      <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>
        플랫폼 계정 연결(OAuth)은 아직 준비 중입니다. 지금은 채널을 등록해 두면 게시 URL을 기록하는 방식으로 성과를 추적합니다.
      </p>
      <ChannelListView workspaceId={workspace.id} items={items} mode="owned" />
    </>
  )
}
