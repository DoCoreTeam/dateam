// app/(ai)/layout.tsx — AI 스튜디오 표면 진입
//
// 셸은 AppShell 하나뿐이다. 새 셸을 만들지 않는다(§2 레이아웃 규칙).
// (crm)·(ci) 와 모양이 비슷하지만 **접근 판정이 다르다** — 저 둘은 워크스페이스 멤버십으로
// 가르는데, AI 스튜디오는 아직 관리자 전용이다(마이그 150 의 RLS 도 admin + owner 다).
// 멤버를 열 때 고칠 곳은 여기와 `NAV_AUDIENCE` 두 줄뿐이다.

import { Sparkles, MessagesSquare, FolderKanban, ListTree, FolderOpen, Cpu } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { redirectApiUser } from '@/lib/auth/api-user-gate'
import { getRequestUser } from '@/lib/supabase/server'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getBranding } from '@/lib/branding'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
import { AI_NAV_GROUPS, aiNavMatchPaths } from '@/lib/ai-chat/nav/groups'
import studio from './studio.module.css'
import NewChatButton from './NewChatButton'

/** 이름은 표(lib/ai-chat/nav/groups)가, 그림은 화면이 정한다 */
const NAV_ICON: Record<string, React.ReactNode> = {
  '/ai': <MessagesSquare size={16} />,
  '/ai/projects': <FolderKanban size={16} />,
  '/ai/analyze': <ListTree size={16} />,
  '/ai/documents': <FolderOpen size={16} />,
  '/ai/models': <Cpu size={16} />,
}

const NAV_GROUPS: NavGroup[] = AI_NAV_GROUPS.map((g) => ({
  label: g.label,
  items: g.items.map((it) => ({
    href: it.href,
    label: it.label,
    icon: NAV_ICON[it.href] ?? <Sparkles size={16} />,
    // 「채팅」은 섹션 루트라 exact 로 둔다 — 안 그러면 /ai/* 어디서나 켜져 있다
    exact: it.href === '/ai',
    match: aiNavMatchPaths(it).slice(1),
  })),
}))

export default async function AiLayout({ children }: { children: React.ReactNode }) {
  // api_user 차단은 호스트 SSOT 를 그대로 부른다(다른 세 레이아웃과 같은 방식).
  // 프로필은 요청당 1회 캐시(getRequestProfile)라 여기서 먼저 읽어도 왕복이 늘지 않는다.
  const profile = await getRequestProfile()
  redirectApiUser(profile?.role)
  await requireAdmin()

  const [branding, globalTheme, user] = await Promise.all([
    getBranding(),
    getActiveTheme(),
    getRequestUser(),
  ])

  return (
    <AppShell
      groups={NAV_GROUPS}
      // 모양은 스킨이, 색은 테마가 정한다(studio.module.css 머리주석)
      surfaceClass={studio.studio}
      /**
       * **테마를 여기서 정하지 않는다.** 색은 사용자가 고른 테마가 정한다.
       *
       * 두 번 틀렸다: 먼저 CSS 모듈에 색을 박았고(그래서 이 화면에서만 테마가 죽었다),
       * 다음엔 claude 테마를 이 표면에 고정했다(같은 결과였다).
       * 「claude.ai 를 클론하라」는 **배치와 조작 방식**을 클론하라는 뜻이었다 —
       * 새 대화가 메뉴 맨 위에 있고, 모델을 입력칸 안에서 고르고, 답변에 말풍선이 없고,
       * 읽는 폭이 정해져 있는 것. 그건 `studio.module.css` 가 하고, 거기엔 색이 한 줄도 없다.
       */
      sidebarTop={<NewChatButton />}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      session={{
        name: profile?.name ?? user?.user_metadata?.name ?? user?.email ?? '팀원',
        email: user?.email ?? '',
        isAdmin: profile?.role === 'admin',
        currentTheme: resolveTheme(profile?.theme_preference, globalTheme),
        defaultTheme: globalTheme,
      }}
    >
      {children}
    </AppShell>
  )
}
