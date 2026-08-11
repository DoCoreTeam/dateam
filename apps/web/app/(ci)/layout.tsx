// app/(ci)/layout.tsx — 콘텐츠 인텔리전스 표면 진입
// 미들웨어가 인증을 보장한다. 여기서는 워크스페이스 소속을 판정한다.
// 소속이 없으면 셸을 씌우지 않고 온보딩(워크스페이스 만들기)으로 넘긴다.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getLoopCounts } from '@/lib/ci/queries/home'
import CiShell from '@/components/ci/CiShell'
import CiOnboardingGate from '@/components/ci/CiOnboardingGate'

export default async function CiLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)

  // 워크스페이스가 없는 첫 사용자 — 빈 대시보드를 보여주지 않는다(설계서 §8.6)
  if (!workspace) {
    return (
      <div className="ci-shell" data-surface="ci">
        <main className="ci-main">
          <div className="page-inner">
            <CiOnboardingGate />
          </div>
        </main>
      </div>
    )
  }

  const counts = await getLoopCounts(workspace.id)

  return (
    <CiShell workspaceId={workspace.id} workspaceName={workspace.name} counts={counts}>
      {children}
    </CiShell>
  )
}
