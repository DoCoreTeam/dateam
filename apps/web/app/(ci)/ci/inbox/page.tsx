// app/(ci)/ci/inbox/page.tsx — R01 수집함 (설계서 §7.2)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listContents } from '@/lib/ci/queries/contents'
import InboxView from './InboxView'

export const dynamic = 'force-dynamic'

type Tab = 'all' | 'review' | 'failed'

export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const tab: Tab = sp.tab === 'review' || sp.tab === 'failed' ? sp.tab : 'all'

  // 탭 배지 건수는 목록과 함께 한 번에 구한다
  const [current, review, failed] = await Promise.all([
    listContents({ workspaceId: workspace.id, tab, corpusOnly: false, sort: 'recent', limit: 30 }),
    listContents({ workspaceId: workspace.id, tab: 'review', corpusOnly: false, limit: 1 }),
    listContents({ workspaceId: workspace.id, tab: 'failed', corpusOnly: false, limit: 1 }),
  ])

  return (
    <InboxView
      workspaceId={workspace.id}
      tab={tab}
      items={current.items}
      counts={{ review: review.total, failed: failed.total }}
    />
  )
}
