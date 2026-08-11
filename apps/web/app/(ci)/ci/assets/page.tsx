// app/(ci)/ci/assets/page.tsx — P04 자료
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import CiPageHeader from '@/components/ci/CiPageHeader'
import AssetsView from './AssetsView'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const adminClient = createAdminClient() as any
  const { data } = await adminClient.from('ci_assets')
    .select('id, kind, storage_path, mime, bytes, created_at')
    .eq('workspace_id', workspace.id).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200)

  return (
    <>
      <CiPageHeader title="자료" desc="제작에 쓴 원본과 산출 파일" />
      <AssetsView workspaceId={workspace.id} assets={(data ?? []).map((a: any) => ({
        id: a.id, kind: a.kind, path: a.storage_path, mime: a.mime,
        bytes: a.bytes, createdAt: a.created_at,
      }))} />
    </>
  )
}
