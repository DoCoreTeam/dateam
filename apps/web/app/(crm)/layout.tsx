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
  Building2, Handshake, Mic, BarChart3, Sun, FileText
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavItem } from '@/components/ui/shell/AppShell'
import { CRM_NAV_GROUPS, crmGroupMatchPaths, CRM_ACCOUNT_ITEMS } from '@/lib/crm/nav/groups'
import { getBranding } from '@/lib/branding'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import { getRequestUser } from '@/lib/supabase/server'
import { resolveCrmAccess, CRM_DENY_MESSAGE } from '@/lib/crm/auth/requireCrmMember'
import { countPendingSuggestions } from '@/lib/crm/services/suggestion'
import CommandPalette from '@/components/crm/CommandPalette'
import AttentionBell from '@/components/crm/AttentionBell'
import MeetingModeToggle from '@/components/crm/MeetingModeToggle'
import { MeetingModeProvider } from '@/lib/crm/ui/meeting-mode'

/**
 * 최상위에는 **매일 여는 것만** 넷. 나머지는 성격별로 묶는다.
 * (거래처 · 기록 · 보기 · 설정 — 그룹 주석에 각각의 이유가 있다)
 */
/**
 * 매일 여는 것만 최상위에 둔다. 순서는 **여는 빈도**다.
 *
 * - `오늘`이 첫 화면 — "지금 손 대야 할 것". 예전엔 인박스였는데,
 *   인박스는 AI 가 넣어 준 것을 확인하는 곳이라 **처음 온 사람에겐 늘 비어 있었다.**
 * - `딜`이 회사·인물보다 앞 — 영업이 하루에 가장 많이 보는 것은 딜이다.
 *   예전엔 회사 → 인물 → 딜 순서였는데 그건 **데이터 모델 순서**이지 사람의 순서가 아니다.
 */
/**
 * 사이드바 — **묶음 다섯.** 정의는 `lib/crm/nav/groups.ts`(SSOT)에 있고 여기서는 그림만 그린다.
 *
 * 왜 13개에서 5개가 됐나 (기획 `docs/2026-08-27-crm-capture-first` 설계 3):
 *   사용자 지적(2026-08-27) *"메뉴가 너무 많은것도 문제야"* · *"연관성 있는건 묶는 작업이
 *   되었는지 모르겠고"*. 실측하면 더 분명하다 — 13개 중 **딜 0건 · 견적 0건 · 할 일 0건**이다.
 *   매일 여는 것과 아직 비어 있는 것이 같은 무게로 늘어서 있어서, 목록이 길어질수록
 *   정작 매일 여는 것이 눈에 안 들어온다.
 *
 * **화면은 하나도 안 없앴다.** 라우트 20개가 그대로 살아 있고 북마크·공유 링크도 그대로다.
 * 바뀐 것은 **어디서 들어가느냐** 하나다 — 묶음 안의 다른 화면으로는
 * 화면 머리의 탭바(`components/crm/CrmGroupTabs.tsx`)로 건너간다.
 *
 * 설정 3개(영업 단계·멤버·설정)는 **계정 메뉴**로 내려갔다. 처음 한 번 정하고 가끔 손보는
 * 것이라, 매일 쓰는 것 옆에 두면 매일 쓰는 것이 안 보인다.
 */
const NAV_ICON: Record<string, React.ReactNode> = {
  '/crm/today': <Sun size={16} />,
  '/crm/deals': <Handshake size={16} />,
  '/crm/companies': <Building2 size={16} />,
  '/crm/meetings': <Mic size={16} />,
  '/crm/reports': <BarChart3 size={16} />,
}

/**
 * 그룹을 만들지 않는다 — 다섯이면 묶음 머리글 없이도 한눈에 들어온다.
 * 항목이 둘뿐인 묶음에 이름을 붙이면 이름이 항목보다 많아진다(§2-3-3 N-3).
 */
const NAV_ITEMS: NavItem[] = CRM_NAV_GROUPS.map((g) => ({
  href: g.href,
  label: g.label,
  icon: NAV_ICON[g.href] ?? <FileText size={16} />,
  // 묶음 안의 어느 화면에 있어도 이 자리가 켜져 있어야 한다 — 안 그러면
  // 「견적」에 들어간 순간 사이드바에서 내가 어디 있는지 사라진다.
  match: crmGroupMatchPaths(g),
}))


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

  const [branding, globalTheme, user, pendingInbox] = await Promise.all([
    getBranding(),
    getActiveTheme(),
    getRequestUser(),
    countPendingSuggestions(access.session.workspaceId),
  ])

  /**
   * 인박스에 몇 건이 기다리는지 메뉴에서 보여 준다.
   *
   * 없으면 사용자는 **인박스를 열어 봐야만** 할 일이 있는지 안다.
   * 그러면 대개 안 열어 보고, AI 가 찾아낸 것은 아무도 모르는 채로 만료된다.
   */
  const navItems = NAV_ITEMS.map((it) => (
    // 인박스가 「오늘」에 흡수됐으므로 배지도 「오늘」에 붙는다.
    // 안 옮기면 배지가 갈 곳이 없어져 **조용히 사라진다** — 그러면 AI 가 찾아낸 것을
    // 아무도 모르는 채로 만료된다(배지를 단 이유가 그것이다).
    it.href === '/crm/today' && pendingInbox > 0 ? { ...it, badge: pendingInbox } : it
  ))

  return (
    <MeetingModeProvider>
    <AppShell
      items={navItems}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      // CRM 안에서는 CRM 을 찾는다 — 밖으로 데리고 나가지 않는다
      search={{ action: '/crm/search', placeholder: '회사·사람·딜 찾기…' }}
      settings={{ label: '영업 CRM 설정', items: CRM_ACCOUNT_ITEMS }}
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
        /**
          * 검색·전체메뉴 앞에 놓는다 — 지금 봐야 할 것이 먼저 눈에 들어와야 한다.
          * 회의 모드도 같은 자리다 — 둘 다 "지금 이 순간"에 관한 것이고,
          * 고객 앞에서 켜야 하므로 **어느 CRM 화면에서든 같은 자리**에 있어야 한다.
          */
        headerExtra: (
          <>
            <MeetingModeToggle />
            <AttentionBell />
          </>
        ),
      }}
    >
      <CommandPalette />
      {children}
    </AppShell>
    </MeetingModeProvider>
  )
}

