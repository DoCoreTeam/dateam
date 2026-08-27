// app/(ci)/ci/monitoring/page.tsx — R02 모니터링 (관심 채널)
import { redirect } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listChannels } from '@/lib/ci/queries/channels'
import { getChannelActivity } from '@/lib/ci/queries/channel-activity'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ChannelListView from '@/components/ci/ChannelListView'

export const dynamic = 'force-dynamic'

export default async function MonitoringPage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  /** 화면 제목이 약속한 기간 — 트렌드 기본값과 같게 둔다(화면마다 다른 창을 쓰면 숫자가 어긋난다) */
  const WINDOW_DAYS = 28

  const [items, activityMap] = await Promise.all([
    listChannels(workspace.id, 'tracked'),
    // "새 게시물과 성과 변화" — 예전엔 이 줄이 없어서 화면이 약속만 하고 아무것도 안 보여줬다
    getChannelActivity(workspace.id, WINDOW_DAYS),
  ])

  return (
    <>
      <PageHeader
        title="모니터링"
        description="지켜볼 채널을 등록하면 새 게시물과 성과 변화를 따라갑니다"
        below={<StageNav stages={RESEARCH_STAGES} />}
      />
      <ChannelListView
        workspaceId={workspace.id}
        items={items}
        mode="tracked"
        activity={Object.fromEntries(activityMap)}
        activityWindowDays={WINDOW_DAYS}
      />
    </>
  )
}
