// app/(ci)/ci/channels/[id]/page.tsx — R03 채널 상세
import { redirect, notFound } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getChannel } from '@/lib/ci/queries/channels'
import { listChannelContents } from '@/lib/ci/queries/channel-contents'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ChannelDetailView from './ChannelDetailView'

export const dynamic = 'force-dynamic'

export default async function ChannelDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const { id } = await params
  const channel = await getChannel(workspace.id, id)
  if (!channel) notFound()

  const contents = await listChannelContents(workspace.id, id)

  return (
    <>
      <PageHeader
        title={channel.displayName}
        description={`${CI_PLATFORM_LABEL[channel.platform]} · ${channel.ownership === 'owned' ? '내 채널' : '관심 채널'}`}
        below={<StageNav stages={RESEARCH_STAGES} />}
        back={{
          href: channel.ownership === 'owned' ? '/ci/my-channels' : '/ci/monitoring',
          label: channel.ownership === 'owned' ? '내 채널' : '모니터링',
        }}
      />
      <ChannelDetailView workspaceId={workspace.id} channel={channel} contents={contents} />
    </>
  )
}
