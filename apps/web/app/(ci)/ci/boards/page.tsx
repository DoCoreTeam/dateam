// app/(ci)/ci/boards/page.tsx — 보드 (발견물 저장함, 설계서 §8.2)
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import PageHeader from '@/components/ui/PageHeader'
import BoardsView from './BoardsView'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BoardsPage({
  searchParams,
}: { searchParams: Promise<{ add?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_boards')
    .select('id, name, created_at, ci_board_items ( id, item_type, item_id )')
    .eq('workspace_id', workspace.id).is('deleted_at', null)
    .order('created_at', { ascending: false })

  const boards = (data ?? []).map((b: any) => ({
    id: b.id, name: b.name, itemCount: (b.ci_board_items ?? []).length,
  }))

  return (
    <>
      <PageHeader title="보드" description="리서치에서 발견한 것을 모아두고 제작으로 넘깁니다" />
      <BoardsView workspaceId={workspace.id} boards={boards} pendingContentId={sp.add ?? null} />
    </>
  )
}
