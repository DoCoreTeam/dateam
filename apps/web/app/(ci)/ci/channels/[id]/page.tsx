// app/(ci)/ci/channels/[id]/page.tsx — R03 채널 상세
import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
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

/** 한 페이지에 보여줄 게시물 수. 목록 표준 기본값보다 크게 잡는다 — 카드 그리드라 한 줄에 4장이다. */
const PAGE_SIZE = 40

export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const { id } = await params
  const channel = await getChannel(workspace.id, id)
  if (!channel) notFound()

  // 목록·대조·주제 목록은 서로를 기다릴 이유가 없다
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const adminClient = createAdminClient() as any
  // 페이지는 URL이 진실이다(§2-6). 링크를 공유하면 받는 사람도 같은 쪽을 본다.
  const sp = await searchParams
  const rawPage = Number(sp.page ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1

  const [contents, contrast, topicRes] = await Promise.all([
    listChannelContents(workspace.id, id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    getAccountContrast(workspace.id, id),
    // 채널 주제를 고르려면 고를 것이 화면에 있어야 한다 — 목록을 함께 내려보낸다
    adminClient.from('ci_topics')
      .select('id, name').eq('workspace_id', workspace.id)
      .is('deleted_at', null).is('merged_into_id', null).order('name'),
  ])
  const topics = (topicRes?.data ?? []) as { id: string; name: string }[]

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
      {/* 분석은 채널 정체(아바타·구독자·수집 현황) 다음에 놓는다 — 대상을 알고 읽는 글이다.
          예전엔 여기서 바로 그려서 제목 바로 밑, 프로필보다 위에 나왔다. */}
      <ChannelDetailView
        workspaceId={workspace.id}
        channel={channel}
        contents={contents.items}
        page={page}
        pageSize={PAGE_SIZE}
        totalContents={contents.total}
        topics={topics}
        insight={<AccountWhyPanel contrast={contrast} />}
      />
    </>
  )
}
