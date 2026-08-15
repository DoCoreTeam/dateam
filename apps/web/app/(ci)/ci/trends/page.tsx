// app/(ci)/ci/trends/page.tsx — R04 트렌드 (탭 4개 전부 동작)
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listContents } from '@/lib/ci/queries/contents'
import { getMarketOverview, getPatterns, getSignals, getTimingOverview } from '@/lib/ci/queries/trends'
import { formatBasis } from '@/lib/ci/format/metrics'
import TrendsView from './TrendsView'
import type { CiContentFormat, CiPlatform } from '@/lib/ci/types'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = ['market', 'outliers', 'patterns', 'signals'] as const
type Tab = typeof TABS[number]

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string; platform?: string; format?: string; windowDays?: string
    sort?: string; topicId?: string
  }>
}) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'outliers'
  const windowDays = Number(sp.windowDays ?? 28) || 28
  const sort = sp.sort === 'recent' || sp.sort === 'velocity' ? sp.sort : 'outlier'
  const topicId = sp.topicId || null

  const adminClient = createAdminClient() as any
  const { data: topicRows } = await adminClient.from('ci_topics')
    .select('id, name').eq('workspace_id', workspace.id)
    .is('deleted_at', null).is('merged_into_id', null).order('name')
  const topics = (topicRows ?? []) as { id: string; name: string }[]

  const [outliers, market, timing, patterns, signals] = await Promise.all([
    tab === 'outliers'
      ? listContents({
          workspaceId: workspace.id,
          corpusOnly: true,
          topicId,
          platform: (sp.platform as CiPlatform) ?? null,
          format: (sp.format as CiContentFormat) ?? null,
          windowDays,
          sort,
          limit: 30,
          // 떡상 탭의 본론은 배수가 아니라 "무엇이 통했나"다
          withCreative: true,
        })
      : Promise.resolve(null),
    tab === 'market' ? getMarketOverview(workspace.id, windowDays, topicId) : Promise.resolve(null),
    tab === 'market' ? getTimingOverview(workspace.id) : Promise.resolve(null),
    tab === 'patterns' ? getPatterns(workspace.id, topicId) : Promise.resolve(null),
    tab === 'signals' ? getSignals(workspace.id, topicId) : Promise.resolve(null),
  ])

  return (
    <TrendsView
      workspaceId={workspace.id}
      tab={tab}
      topics={topics}
      topicId={topicId}
      items={outliers?.items ?? []}
      population={outliers?.population ?? 0}
      windowDays={windowDays}
      sort={sort}
      platform={sp.platform ?? ''}
      format={sp.format ?? ''}
      basisText={formatBasis(windowDays, outliers?.population ?? 0)}
      market={market}
      timing={timing}
      patterns={patterns}
      signals={signals}
    />
  )
}
