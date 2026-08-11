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
        채널을 등록해 두면 게시 화면에서 올린 주소를 기록하는 것만으로 성과가 추적됩니다.
      </p>
      <ChannelListView workspaceId={workspace.id} items={items} mode="owned" />
    </>
  )
}
