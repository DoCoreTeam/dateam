// app/(trading)/layout.tsx — AI 트레이딩 셸
//
// **왜 셸을 따로 두나** (사용자 지적 2026-09-27: 「다른 서비스들처럼 왜 별도의 메뉴 구성이
// 안되나?」): 앞 판까지 이 화면은 `(member)` 셸 안의 화면 하나였다. 사이드바 「서비스」 묶음에
// 줄은 섰지만 들어가도 사이드바가 안 바뀌고 나가는 문도 없었다 — 들어가는 문만 같고 안은
// 다른 상태였고, 그건 §2-3-3 N-1·N-2 를 절반만 지킨 것이다.
//
// **새 셸을 만들지 않는다.** 셸은 `AppShell` 하나뿐이고 여기서는 무엇을 그릴지만 정한다
// (호스트 §2 레이아웃 규칙). `(crm)`·`(ci)` 와 같은 골격이다.
//
// **옮기면서 문이 빠지지 않게** — `(member)` 레이아웃이 걸던 것을 여기서 다시 건다.
// 화면을 다른 라우트 그룹으로 옮기면 그 그룹의 레이아웃은 **더 이상 안 돈다.** 그 사실은
// 오류를 안 내고, 빠뜨린 문은 조용히 열려 있다. 그래서 넷을 그대로 옮겨 적는다.
//   ① api 전용 계정 차단  ② 관리자 2단계 인증  ③ 표면 접근권한  ④ 소유자
// ④ 는 `trading/layout.tsx` 가 계속 맡는다 — 축이 다른 규칙이라 한 함수에 안 섞는다.

import { redirect } from 'next/navigation'
import { redirectApiUser, requireAdminMfa } from '@/lib/auth/api-user-gate'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavItem } from '@/components/ui/shell/AppShell'
import AccessDenied from '@/components/ui/AccessDenied'
import { canOpen } from '@/lib/access/guard'
import { getBranding } from '@/lib/branding'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import { getRequestUser } from '@/lib/supabase/server'
import { CandlestickChart, FileText } from 'lucide-react'
import { SERVICE_LABEL } from '@/lib/terms'
import { TRADING_NAV } from '@/lib/trading/nav/groups'

/**
 * 사이드바 항목 — 목록은 `lib/trading/nav/groups.ts` 가 주고 여기서는 **그림만** 그린다.
 *
 * 묶음(`groups`)이 아니라 항목(`items`)으로 세운다: 항목이 둘뿐인 묶음에 이름을 붙이면
 * 이름이 항목보다 많아진다(§2-3-3 N-3). 영업 CRM 도 같은 이유로 묶음을 안 쓴다.
 */
const NAV_ICON: Record<string, React.ReactNode> = {
  '/trading': <CandlestickChart size={16} />,
}

const NAV_ITEMS: NavItem[] = TRADING_NAV.map((n) => ({
  href: n.href,
  label: n.label,
  // 빠뜨린 그림은 오류처럼 안 보이고 그 줄만 조용히 빈다 — 기본값을 둬 빈 칸을 안 만든다
  icon: NAV_ICON[n.href] ?? <FileText size={16} />,
  ...(n.match ? { match: [...n.match] } : {}),
}))

export default async function TradingShellLayout({ children }: { children: React.ReactNode }) {
  const profile = await getRequestProfile()
  await redirectApiUser(profile?.role)
  await requireAdminMfa(profile?.role)

  const user = await getRequestUser()
  if (!user) redirect('/login')

  /**
   * 접근권한이 이 문을 닫아 뒀나. 소유자 확인과 **다른 질문**이다 —
   * 이쪽은 「회사가 이 사람에게 이 문을 열어 줬나」이고, 소유자는 「이 자료가 이 사람 것인가」다.
   */
  if (!(await canOpen('/trading'))) return <AccessDenied what={SERVICE_LABEL.trading} standalone />

  const [branding, globalTheme] = await Promise.all([getBranding(), getActiveTheme()])

  return (
    <AppShell
      items={NAV_ITEMS}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      session={{
        name: profile?.name || '팀원',
        email: user.email ?? '',
        isAdmin: profile?.role === 'admin',
        currentTheme: resolveTheme(profile?.theme_preference, globalTheme),
        defaultTheme: globalTheme,
      }}
    >
      {children}
    </AppShell>
  )
}
