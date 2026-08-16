// app/(crm)/layout.tsx — 영업 CRM 표면 진입 (dacrm T1-01)
//
// 셸은 AppShell 하나뿐이다. 새 셸을 만들지 않는다(호스트 §2 레이아웃 규칙).
// CI 레이아웃과 모양이 비슷하지만 **그대로 베끼지 않았다** — 두 가지가 다르다.
//   1) 삭제된 계정 차단: getRequestProfile 은 deleted_at 필터를 일부러 안 건다.
//      호스트에서 이 판단을 하는 셸은 admin 하나뿐이라, (ci) 를 베끼면 그대로 빠진다.
//      CRM 은 영업 데이터라 비활성 계정이 들어오면 안 된다.
//   2) 워크스페이스 소속이 없으면 온보딩이 아니라 **차단**이다.
//      dacrm 은 내부 앱 모듈이라 사용자가 워크스페이스를 스스로 만들지 않는다.
//      관리자가 멤버로 넣어 줘야 들어온다.

import { redirect } from 'next/navigation'
import { redirectApiUser } from '@/lib/auth/api-user-gate'
import {
  Inbox, Building2, Users, Handshake, Mic, Workflow, BarChart3, Settings,
  Home, Briefcase, CalendarDays, CheckSquare, History,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
import { getBranding } from '@/lib/branding'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import { getRequestUser } from '@/lib/supabase/server'
import { resolveCrmAccess, CRM_DENY_MESSAGE } from '@/lib/crm/auth/requireCrmMember'

/**
 * 사이드바 8개 항목 (구현명세서 1.1 라우트 구조 그대로).
 * 일상 동선 4개는 최상위에, 나머지는 성격별로 묶는다.
 */
const NAV_ITEMS = [
  { href: '/crm/inbox', label: '인박스', icon: <Inbox size={16} /> },
  { href: '/crm/companies', label: '회사', icon: <Building2 size={16} /> },
  { href: '/crm/people', label: '인물', icon: <Users size={16} /> },
  { href: '/crm/deals', label: '딜', icon: <Handshake size={16} /> },
]

const NAV_GROUPS: NavGroup[] = [
  {
    label: '기록',
    items: [
      { href: '/crm/meetings', label: '미팅', icon: <Mic size={16} /> },
      { href: '/crm/tasks', label: '할 일', icon: <CheckSquare size={16} /> },
      { href: '/crm/audit', label: '기록', icon: <History size={16} /> },
      { href: '/crm/process', label: '프로세스', icon: <Workflow size={16} /> },
    ],
  },
  {
    label: '분석',
    items: [{ href: '/crm/reports', label: '리포트', icon: <BarChart3 size={16} /> }],
  },
  {
    label: '관리',
    items: [
      { href: '/crm/members', label: '멤버', icon: <Users size={16} /> },
      { href: '/crm/settings', label: '설정', icon: <Settings size={16} /> },
    ],
  },
  {
    /**
     * CRM 밖으로 나가는 길.
     *
     * 이게 없으면 CRM 에 들어온 사람은 **돌아갈 방법이 없다** — 사이드바가 통째로
     * CRM 것으로 바뀌기 때문이다(실사용에서 지적받았다: "CRM에서 업무 화면으로 가는 게 없다").
     * 호스트에서 CRM 으로 오는 링크는 있는데 반대가 없으면 그건 문이 아니라 함정이다.
     *
     * 자주 쓰는 곳만 둔다 — 사이드바를 통째로 복제하면 여기가 두 번째 메뉴 정의가 되고,
     * 호스트 메뉴가 바뀔 때마다 두 곳을 고쳐야 한다. 나머지는 상단 전체 메뉴로 간다.
     */
    label: '돌아가기',
    items: [
      { href: '/home', label: '홈', icon: <Home size={16} /> },
      { href: '/work', label: '업무', icon: <Briefcase size={16} /> },
      { href: '/calendar', label: '캘린더', icon: <CalendarDays size={16} /> },
    ],
  },
]

/**
 * 못 들어온 이유를 사용자의 말로 알려 주는 화면. 셸을 씌우지 않는다 — 셸은 멤버의 것이다.
 * 형태는 전역 404(app/not-found.tsx)와 맞춘다: 이것도 "없는 것을 알리고 다음 행동을 주는" 빈 상태다.
 */
function CrmDenied({ reason }: { reason: 'api_user' | 'deleted_account' | 'not_a_member' }) {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-4)', padding: 'var(--space-6)',
        textAlign: 'center', background: 'var(--surface-bg)', color: 'var(--text)',
      }}
    >
      <EmptyState
        title={CRM_DENY_MESSAGE[reason]}
        description="영업 CRM은 관리자가 멤버로 추가한 사람만 볼 수 있습니다."
        icon={<Handshake size={28} />}
        action={{ label: '홈으로 돌아가기', href: '/home' }}
      />
    </main>
  )
}

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  // api_user 차단은 호스트 SSOT 를 그대로 부른다(다른 세 레이아웃과 같은 방식).
  // resolveCrmAccess 도 같은 판정을 갖고 있지만 그건 API 라우트용이다 —
  // 화면 게이트는 호스트 가드가 스캔하는 이 호출이 근거다(lib/auth/api-user-gate.test.ts).
  // 프로필은 요청당 1회 캐시(getRequestProfile)라 여기서 먼저 읽어도 왕복이 늘지 않는다.
  const profile = await getRequestProfile()
  redirectApiUser(profile?.role)

  const access = await resolveCrmAccess()

  if (!access.ok) {
    // 로그인이 없으면 로그인으로 — 여기선 보여 줄 것이 없다.
    if (access.reason === 'no_session') redirect('/login')

    // 나머지는 **그 자리에서 이유를 말한다.**
    //
    // 처음엔 `/home?crm=denied&reason=…` 으로 튕겼는데, 실브라우저로 확인해 보니
    // 홈 화면이 그 쿼리를 아무 데서도 표시하지 않아 **사용자는 그냥 홈으로 튕긴 것으로만 보였다.**
    // 호스트의 복귀 경로 정책이 경고한 바로 그 사고다 —
    // "결과를 붙여만 놓고 안 보여주면 실패가 조용히 묻힌다"(Drive 연동 전례).
    // 튕기지 않고 여기서 말하면 주소도 그대로라 새로고침해도 같은 안내가 나온다.
    return <CrmDenied reason={access.reason} />
  }

  const [branding, globalTheme, user] = await Promise.all([
    getBranding(),
    getActiveTheme(),
    getRequestUser(),
  ])

  return (
    <AppShell
      items={NAV_ITEMS}
      groups={NAV_GROUPS}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      session={{
        name: access.session.displayName || profile?.name || '팀원',
        email: user?.email ?? '',
        isAdmin: profile?.role === 'admin',
        currentTheme: resolveTheme(profile?.theme_preference, globalTheme),
        defaultTheme: globalTheme,
      }}
      extras={{
        headerLeft: (
          <span
            style={{
              fontSize: 'var(--fs-base)', color: 'var(--text-muted)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            영업 CRM ·{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>
              {access.session.displayName}
            </strong>
          </span>
        ),
      }}
    >
      {children}
    </AppShell>
  )
}

