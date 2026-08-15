// app/(ci)/ci/channels/[id]/page.tsx — R03 채널 상세
import { redirect, notFound } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getChannel } from '@/lib/ci/queries/channels'
import { listChannelContents } from '@/lib/ci/queries/channel-contents'
import { getAccountContrast } from '@/lib/ci/queries/account-why'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import AccountWhyPanel from '@/components/ci/AccountWhyPanel'
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

  // 목록과 대조는 서로를 기다릴 이유가 없다
  const [contents, contrast] = await Promise.all([
    listChannelContents(workspace.id, id),
    getAccountContrast(workspace.id, id),
  ])

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
      {/* "왜 잘 됐나"를 게시물 목록보다 먼저 둔다 — 사용자가 이걸 보러 들어온다 */}
      <AccountWhyPanel contrast={contrast} />
      <ChannelDetailView workspaceId={workspace.id} channel={channel} contents={contents} />
    </>
  )
}
