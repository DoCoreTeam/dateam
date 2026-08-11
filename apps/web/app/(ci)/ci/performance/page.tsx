// app/(ci)/ci/performance/page.tsx — A01 성과 (탭 3개)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getMinePerformance, getMarketPerformance, getLearningPerformance } from '@/lib/ci/queries/performance'
import CiPageHeader from '@/components/ci/CiPageHeader'
import PerformanceView from './PerformanceView'

export const dynamic = 'force-dynamic'

const TABS = ['mine', 'market', 'learning'] as const
type Tab = typeof TABS[number]

export default async function PerformancePage({
  searchParams,
}: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'mine'

  const [mine, market, learning] = await Promise.all([
    tab === 'mine' ? getMinePerformance(workspace.id) : Promise.resolve(null),
    tab === 'market' ? getMarketPerformance(workspace.id) : Promise.resolve(null),
    tab === 'learning' ? getLearningPerformance(workspace.id) : Promise.resolve(null),
  ])

  return (
    <>
      <CiPageHeader title="성과" desc="내 콘텐츠가 평소와 시장 대비 어땠는지" />
      <PerformanceView tab={tab} mine={mine} market={market} learning={learning} />
    </>
  )
}
