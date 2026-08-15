// app/(ci)/ci/publish/page.tsx — B01 게시
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listChannels } from '@/lib/ci/queries/channels'
import PageHeader from '@/components/ui/PageHeader'
import PublishView from './PublishView'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PublishPage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const adminClient = createAdminClient() as any
  const { data } = await adminClient.from('ci_publications')
    .select('id, platform, route, status, scheduled_at, published_at, published_url, error_code, error_message')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false }).limit(100)

  const owned = await listChannels(workspace.id, 'owned')

  return (
    <>
      <PageHeader title="게시" description="예약하고 내보내고, 올린 주소를 기록해 성과를 추적합니다" />
      <PublishView workspaceId={workspace.id} items={data ?? []} ownedChannels={owned} />
    </>
  )
}
