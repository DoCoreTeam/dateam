// app/(ci)/ci/settings/page.tsx — S01 설정
// 설계서 §10.2: 폼은 Zod 스키마 레지스트리에서 자동 생성한다(신규 설정 추가 시 화면 코드 수정 없음).
import { redirect } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import PageHeader from '@/components/ui/PageHeader'
import SettingsView from './SettingsView'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  return (
    <>
      <PageHeader
        title="설정"
        description={`${workspace.name} · 내 권한: ${workspace.role}`}
      />
      <SettingsView workspaceId={workspace.id} />
    </>
  )
}
