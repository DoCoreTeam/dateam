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
import type { NavGroup, NavItem } from '@/components/ui/shell/AppShell'
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
  /**
   * 아직 아무것도 없는 화면은 메뉴에 올리지 않는다 — 하나라도 생기면 저절로 올라온다.
   *
   * 왜(2026-08-27 실측): 메뉴 13개 중 5개가 **완전히 빈 화면**이었다
   * (편집점 0 · 보드 0 · 게시 0 · 내 채널 0). 매일 보는 메뉴의 절반이 빈 방이었다.
   * 그렇다고 지울 수는 없다 — 만드는 흐름의 뒷단계라 언젠가 쓴다.
   * 그래서 «필요할 때 나타나게» 한다. 사람이 메뉴를 관리하지 않아도 된다.
   *
   * counts 를 못 읽었으면(undefined) 접지 않는다 — 조회 실패로 메뉴가 사라지면 안 된다.
   */
  const has = (n: number | undefined) => counts === undefined || (n ?? 0) > 0

  const research: NavItem[] = [
    // 맨 앞이다 — 사용자가 매일 처음 던지는 질문이 "뭘 만들까"이기 때문이다.
    { href: '/ci/recommend', label: '오늘 뭘 만들까', icon: <Sparkles size={16} /> },
    { href: '/ci/inbox', label: '수집함', icon: <Inbox size={16} />, badge: badge(counts?.review) },
    // 채널을 등록하는 곳과 그 결과가 쌓이는 곳은 한 흐름이다 — 수집함 바로 다음에 둔다
    { href: '/ci/monitoring', label: '모니터링', icon: <Radar size={16} />, match: ['/ci/channels'] },
    { href: '/ci/trends', label: '트렌드', icon: <TrendingUp size={16} />, badge: badge(counts?.newOutliers) },
  ]

  const make: NavItem[] = [
    { href: '/ci/pipeline', label: '파이프라인', icon: <PenTool size={16} />, match: ['/ci/briefs'], badge: badge(counts?.producing) },
    // 편집점·보드는 파이프라인의 뒷단계다. 기획이 생겨야 쓸 일이 있다.
    ...(has(counts?.editPlans) ? [{ href: '/ci/studio', label: '편집점', icon: <Scissors size={16} /> }] : []),
    ...(has(counts?.boards) ? [{ href: '/ci/boards', label: '보드', icon: <Layers size={16} /> }] : []),
    { href: '/ci/assets', label: '자료', icon: <Layers size={16} /> },
  ]

  // 게시는 내보낼 것이 있거나 내 채널을 연결했을 때부터 뜻이 있다
  const publish: NavItem[] = [
    ...(has(counts?.publications) ? [{ href: '/ci/publish', label: '게시', icon: <Send size={16} />, badge: badge(counts?.ready) }] : []),
    ...(has(counts?.ownChannels) ? [{ href: '/ci/my-channels', label: '내 채널', icon: <Radio size={16} /> }] : []),
  ]

  const groups: NavGroup[] = [
    { label: '리서치', items: research },
    { label: '제작', items: make },
  ]
  // 그룹은 항목 2개 이상일 때만 — 하나짜리 그룹은 이름만 차지한다(§2-3-3 N-3)
  if (publish.length >= 2) groups.push({ label: '게시', items: publish })
  else if (publish.length === 1) make.push(publish[0])

  // 「성과」 그룹 안에 「성과」 항목이 있었다 — 그룹 이름과 항목 이름이 같으면 그 그룹은 없앤다(N-3).
  // 성과와 설정은 성격도 다르다. 묶지 않고 최상위에 둔다.
  groups.push({
    // 이름이 「성과」였고 그 안에 「성과」 항목이 있었다 — 같은 말이 두 번 나오면 헷갈린다(N-3).
    // 성과와 설정은 성격도 달라 하나로 묶을 이름이 없다. 그러면 «그 밖»이 정직한 이름이다.
    label: '그 밖',
    items: [
      { href: '/ci/performance', label: '성과', icon: <BarChart3 size={16} /> },
      { href: '/ci/settings', label: '설정', icon: <Settings size={16} /> },
    ],
  })

  return groups
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
