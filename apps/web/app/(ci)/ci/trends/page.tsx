// app/(ci)/ci/trends/page.tsx — R04 트렌드 (설계서 §7.3)
// 탭 4개 중 Slice 1은 '떡상'을 실동작시킨다. 나머지는 아직 비어 있음을 정직하게 밝힌다.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listContents } from '@/lib/ci/queries/contents'
import { formatBasis } from '@/lib/ci/format/metrics'
import TrendsView from './TrendsView'
import type { CiContentFormat, CiPlatform } from '@/lib/ci/types'

export const dynamic = 'force-dynamic'

const TABS = ['market', 'outliers', 'patterns', 'signals'] as const
type Tab = typeof TABS[number]

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; platform?: string; format?: string; windowDays?: string; sort?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'outliers'
  const windowDays = Number(sp.windowDays ?? 28) || 28
  const sort = sp.sort === 'recent' || sp.sort === 'velocity' ? sp.sort : 'outlier'

  const result = tab === 'outliers'
    ? await listContents({
        workspaceId: workspace.id,
        corpusOnly: true,
        platform: (sp.platform as CiPlatform) ?? null,
        format: (sp.format as CiContentFormat) ?? null,
        windowDays,
        sort,
        limit: 30,
      })
    : { items: [], total: 0, cursor: null, population: 0 }

  return (
    <TrendsView
      workspaceId={workspace.id}
      tab={tab}
      items={result.items}
      population={result.population}
      windowDays={windowDays}
      sort={sort}
      platform={sp.platform ?? ''}
      format={sp.format ?? ''}
      basisText={formatBasis(windowDays, result.population)}
    />
  )
}
