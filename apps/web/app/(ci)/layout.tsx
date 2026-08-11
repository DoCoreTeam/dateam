// app/(ci)/layout.tsx — 콘텐츠 인텔리전스 표면 진입
// 미들웨어가 인증을 보장한다. 여기서는 워크스페이스 소속을 판정한다.
// 소속이 없으면 셸을 씌우지 않고 온보딩(워크스페이스 만들기)으로 넘긴다.
//
// 셸·로고·계정·전체메뉴는 사내 업무 화면과 같은 구성 요소를 그대로 쓴다.

import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getBranding } from '@/lib/branding'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getLoopCounts } from '@/lib/ci/queries/home'
import CiShell from '@/components/ci/CiShell'
import CiOnboardingGate from '@/components/ci/CiOnboardingGate'
import type { Profile } from '@/types/database'

export default async function CiLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const [workspace, branding, profileResult, globalTheme] = await Promise.all([
    resolveActiveWorkspace(user.id),
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, theme_preference')
      .eq('id', user.id)
      .single() as unknown as Promise<{
        data: Pick<Profile, 'name' | 'role' | 'theme_preference'> | null
      }>,
    getActiveTheme(),
  ])

  const profile = profileResult.data
  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''
  const isAdmin = profile?.role === 'admin'
  const currentTheme = resolveTheme(profile?.theme_preference, globalTheme)

  // 워크스페이스가 없는 첫 사용자 — 빈 대시보드를 보여주지 않는다(설계서 §8.6)
  if (!workspace) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
        <div className="page-inner">
          <CiOnboardingGate />
        </div>
      </main>
    )
  }

  const counts = await getLoopCounts(workspace.id)

  return (
    <CiShell
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      logoUrl={branding.logoUrl}
      brandName={branding.brandName}
      counts={counts}
      profile={{
        name: displayName,
        email: userEmail,
        isAdmin,
        currentTheme,
        defaultTheme: globalTheme,
      }}
    >
      {children}
    </CiShell>
  )
}
