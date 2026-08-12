// app/(ci)/ci/assets/page.tsx — P04 자료
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listAssets } from '@/lib/ci/queries/assets'
import { getDriveConnectionStatus } from '@/lib/google-drive'
import PageHeader from '@/components/ui/PageHeader'
import AssetsView from './AssetsView'

export const dynamic = 'force-dynamic'

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  // 첫 장만 서버에서 그린다. 나머지는 사용자가 요청할 때(검색·더 보기) 가져온다.
  // 드라이브 상태 조회가 실패해도 화면은 떠야 한다 — 업로드만 잠근다.
  const [page, drive] = await Promise.all([
    listAssets({ workspaceId: workspace.id }),
    getDriveConnectionStatus().catch(() => ({ connected: false, email: null })),
  ])

  return (
    <>
      <PageHeader
        title="자료"
        description="제작에 쓴 원본과 산출물 — 파일은 구글드라이브에 보관하고 우리는 분석 정보만 갖습니다"
      />
      <AssetsView
        workspaceId={workspace.id}
        initialItems={page.items}
        initialCursor={page.nextCursor}
        total={page.total}
        driveConnected={drive.connected}
        driveEmail={drive.email}
      />
    </>
  )
}
