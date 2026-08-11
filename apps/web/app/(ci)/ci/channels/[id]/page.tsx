// app/(ci)/ci/channels/[id]/page.tsx — R03 채널 상세
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getChannel } from '@/lib/ci/queries/channels'
import { listChannelContents } from '@/lib/ci/queries/channel-contents'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import CiPageHeader from '@/components/ci/CiPageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ChannelDetailView from './ChannelDetailView'

export const dynamic = 'force-dynamic'

export default async function ChannelDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const { id } = await params
  const channel = await getChannel(workspace.id, id)
  if (!channel) notFound()

  const contents = await listChannelContents(workspace.id, id)

  return (
    <>
      <CiPageHeader
        title={channel.displayName}
        desc={`${CI_PLATFORM_LABEL[channel.platform]} · ${channel.ownership === 'owned' ? '내 채널' : '관심 채널'}`}
        stageNav={<StageNav stages={RESEARCH_STAGES} />}
        actions={
          <Link href={channel.ownership === 'owned' ? '/ci/my-channels' : '/ci/monitoring'} className="btn-ghost">
            목록으로
          </Link>
        }
      />
      <ChannelDetailView workspaceId={workspace.id} channel={channel} contents={contents} />
    </>
  )
}
