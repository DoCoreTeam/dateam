// app/(ci)/layout.tsx — 콘텐츠 인텔리전스 표면 진입
// 미들웨어가 인증을 보장한다. 여기서는 워크스페이스 소속을 판정한다.
// 소속이 없으면 셸을 씌우지 않고 온보딩(워크스페이스 만들기)으로 넘긴다.
//
// 셸은 AppShell 하나뿐이다. CI 전용 셸(CiShell)을 따로 두던 시절엔
// 전역검색이 통째로 빠져 있었다 — 자유 슬롯이라 "안 꽂으면 없는" 구조였기 때문.
// 이제 검색·계정·전체메뉴는 AppShell이 항상 넣고, CI는 메뉴·알림·어시스턴트만 얹는다.

import { redirect } from 'next/navigation'
import { redirectApiUser } from '@/lib/auth/api-user-gate'
import {
  Home, Inbox, Radar, TrendingUp, PenTool, Layers, Send, Radio, BarChart3, Settings, Scissors, Sparkles,
} from 'lucide-react'
import { getRequestUser } from '@/lib/supabase/server'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getBranding } from '@/lib/branding'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getLoopCounts } from '@/lib/ci/queries/home'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
import CiOnboardingGate from '@/components/ci/CiOnboardingGate'
import AssistantPanel from '@/components/ci/AssistantPanel'
import NotificationBell from '@/components/ci/NotificationBell'
import QueueDriver from '@/components/ci/QueueDriver'
import { countPendingJobs } from '@/lib/ci/jobs/queue'
import type { CiLoopMinimap } from '@/lib/ci/contracts'

const NAV_ITEMS = [
  // 섹션 루트라 exact로 둔다 — 안 그러면 /ci/* 어디서나 '홈'이 활성으로 남는다
  { href: '/ci', label: '홈', icon: <Home size={16} />, exact: true },
]

/** 건수는 사이드바 badge 슬롯으로 넘긴다. 라벨에 숫자를 붙이지 않는다. */
function badge(count?: number): number | undefined {
  return count && count > 0 ? count : undefined
}

function buildGroups(counts?: CiLoopMinimap): NavGroup[] {
  return [
    {
      label: '리서치',
      items: [
        // 맨 앞이다 — 사용자가 매일 처음 던지는 질문이 "뭘 만들까"이기 때문이다.
        // 수집함·모니터링은 그 답을 만들기 위한 재료이지 매일 볼 화면이 아니다.
        { href: '/ci/recommend', label: '오늘 뭘 만들까', icon: <Sparkles size={16} /> },
        { href: '/ci/inbox', label: '수집함', icon: <Inbox size={16} />, badge: badge(counts?.review) },
        { href: '/ci/monitoring', label: '모니터링', icon: <Radar size={16} />, match: ['/ci/channels'] },
        { href: '/ci/trends', label: '트렌드', icon: <TrendingUp size={16} />, badge: badge(counts?.newOutliers) },
      ],
    },
    {
      label: '제작',
      items: [
        { href: '/ci/pipeline', label: '파이프라인', icon: <PenTool size={16} />, match: ['/ci/briefs'], badge: badge(counts?.producing) },
        { href: '/ci/studio', label: '편집점', icon: <Scissors size={16} /> },
        { href: '/ci/boards', label: '보드', icon: <Layers size={16} /> },
        { href: '/ci/assets', label: '자료', icon: <Layers size={16} /> },
      ],
    },
    {
      label: '게시',
      items: [
        { href: '/ci/publish', label: '게시', icon: <Send size={16} />, badge: badge(counts?.ready) },
        { href: '/ci/my-channels', label: '내 채널', icon: <Radio size={16} /> },
      ],
    },
    {
      label: '성과',
      items: [
        { href: '/ci/performance', label: '성과', icon: <BarChart3 size={16} /> },
        { href: '/ci/settings', label: '설정', icon: <Settings size={16} /> },
      ],
    },
  ]
}

export default async function CiLayout({ children }: { children: React.ReactNode }) {
  const user = await getRequestUser()
  if (!user) redirect('/login')

  // 프로필은 공용 리더(요청당 1회)를 쓴다 — 루트 layout의 테마 계산과 같은 행이라
  // 예전엔 같은 요청에서 두 번 읽었다. (docs/2026-08-16-performance-audit/PLAN.md §2-2)
  const [workspace, branding, profile, globalTheme] = await Promise.all([
    resolveActiveWorkspace(user.id),
    getBranding(),
    getRequestProfile(),
    getActiveTheme(),
  ])
  // (member)와 같은 이유 — role은 위 조회에 이미 들어 있다
  redirectApiUser(profile?.role)
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
  // 남은 잡 수 — 셸이 그릴 때 이미 알 수 있는 값이다.
  // 조회 1회를 더 쓰지만, 화면을 열자마자 상태를 아는 값이 그보다 크다.
  const pendingJobs = await countPendingJobs(workspace.id).catch(() => 0)


  return (
    <AppShell
      items={NAV_ITEMS}
      groups={buildGroups(counts)}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      session={{
        name: displayName,
        email: userEmail,
        isAdmin,
        currentTheme,
        defaultTheme: globalTheme,
      }}
      workspace={{ name: workspace.name }}
      extras={{
        // 떡상 알림은 "매일 접속할 이유의 1번"(§8.1)이라 화면이 아니라 셸에 붙는다.
        headerExtra: <NotificationBell workspaceId={workspace.id} />,
        dock: [
          // 어시스턴트는 좌표를 스스로 정하지 않는다 — Dock의 assistant 슬롯에 등록만 한다.
          { slot: 'assistant', node: <AssistantPanel workspaceId={workspace.id} /> },
          // 큐 구동기. 크론을 늘리지 않고 큐를 돌리는 주 경로다(설계 §7-0 A).
          // 화면이 열려 있는 동안만 짧은 요청을 반복하고, 진행 중이거나 멈췄을 때만 보인다.
          // 서버가 아는 남은 건수를 함께 넘긴다 — 첫 tick을 기다리는 동안,
          // 그리고 탭이 배경에 있는 동안 화면이 "아무 일도 없음"으로 보이지 않게.
          {
            slot: 'utility',
            node: <QueueDriver workspaceId={workspace.id} initialRemaining={pendingJobs} />,
          },
        ],
      }}
    >
      {children}
    </AppShell>
  )
}
