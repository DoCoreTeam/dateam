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
  CheckSquare, History, Sun, FileText
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
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
const NAV_ITEMS = [
  { href: '/crm/today', label: '오늘', icon: <Sun size={16} /> },
  { href: '/crm/inbox', label: '인박스', icon: <Inbox size={16} /> },
  { href: '/crm/deals', label: '딜', icon: <Handshake size={16} /> },
  // 견적이 딜 바로 뒤 — 견적은 딜 금액의 **근거 문서**라 둘은 같이 본다.
  // 예전엔 딜 상세 안에만 있어서 사이드바에서 보이지 않았고, 그래서 "견적이 없다"고 읽혔다.
  { href: '/crm/quotes', label: '견적', icon: <FileText size={16} /> },
]

const NAV_GROUPS: NavGroup[] = [
  {
    /**
     * **회사와 인물은 한 덩어리다.** 사용자 지적(2026-08-27):
     * *"현재 CRM에 메뉴가 상당히 많은데 **연관성 있는건 묶는 작업**이 되었는지 모르겠고"*.
     *
     * 둘은 늘 함께 본다 — 인물은 회사에 붙어 있고, 회사를 열면 그 사람들을 본다.
     * 그런데 최상위에 나란히 서 있으면 매일 여는 것(오늘·인박스·딜·견적)과 **같은 무게**로
     * 늘어서서, 목록이 길어질수록 정작 매일 여는 것이 눈에 안 들어온다.
     * 최상위를 6개에서 4개로 줄이는 것이 이 묶음의 목적이다.
     *
     * 묶음 이름이 「거래처」인 것은 용어집이 정한 그대로다 —
     * *"「거래처」는 **메뉴 묶음 이름**이고 개체 이름은 「회사」다 — 둘을 섞지 않는다"*
     * (`lib/terms/entity.ts`). 그래서 그룹은 거래처, 항목은 회사·인물이다.
     */
    label: '거래처',
    items: [
      { href: '/crm/companies', label: '회사', icon: <Building2 size={16} /> },
      { href: '/crm/people', label: '인물', icon: <Users size={16} /> },
    ],
  },
  {
    // 매일은 아니지만 자주 여는 것
    label: '기록',
    items: [
      { href: '/crm/meetings', label: '미팅', icon: <Mic size={16} /> },
      { href: '/crm/tasks', label: '할 일', icon: <CheckSquare size={16} /> },
    ],
  },
  {
    // 가끔 열어 보는 것 — 변경 이력도 성격상 "본다"에 가깝다
    label: '보기',
    items: [
      { href: '/crm/reports', label: '리포트', icon: <BarChart3 size={16} /> },
      // 그룹 이름이 "기록"인데 항목도 "기록"이면 같은 말이 두 번 나온다
      { href: '/crm/audit', label: '변경 이력', icon: <History size={16} /> },
    ],
  },
  {
    // 처음 한 번 정하고 가끔 손보는 것
    label: '설정',
    items: [
      /**
       * 영업 단계는 **처음에 한 번 정하고 가끔 손보는 것**이다.
       * 예전엔 [기록] 그룹에 "프로세스"라는 이름으로 8번째에 있었다 —
       * 매일 쓰는 것 사이에 끼어 있어 처음 온 사람이 못 찾았다.
       * 통상의 CRM 도 이걸 설정 안에 둔다(Pipedrive: 설정 → 회사 설정 → Pipelines and stages).
       */
      { href: '/crm/process', label: '영업 단계', icon: <Workflow size={16} /> },
      { href: '/crm/members', label: '멤버', icon: <Users size={16} /> },
      { href: '/crm/settings', label: '설정', icon: <Settings size={16} /> },
    ],
  },
  /**
   * **밖으로 나가는 길은 사이드바에 두지 않는다** (v0.7.540, 사용자 지시:
   * "돌아가기도 콘텐츠 인텔리전스랑 동일하게").
   *
   * 예전엔 [돌아가기] 그룹에 홈·업무·캘린더 3개를 뒀다. 이유는 있었다 —
   * 사이드바가 통째로 CRM 것으로 바뀌어 나갈 문이 없다는 지적을 받았기 때문이다.
   * 그런데 그렇게 고치니 **메뉴가 15개가 됐다.** 매일 쓰는 5개가
   * 가끔 쓰는 것·나가는 문과 같은 무게로 늘어서서, 목록이 길어질수록
   * 정작 매일 여는 것이 눈에 안 들어온다(사용자 지적: "메뉴가 너무 나열되어 있다").
   *
   * 콘텐츠 인텔리전스는 같은 문제를 다르게 풀었다 — **나가는 문을 상단
   * `전체 메뉴`에 두고 사이드바는 그 표면의 일만 담는다.** 그 메뉴에 홈·일일업무·
   * 캘린더·주간보고가 이미 다 있으므로(QuickNav) 나갈 길은 그대로 살아 있다.
   * 함정이 되지 않으면서 사이드바는 12개로 줄어든다 — CI 와 같은 수다.
   */
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
    it.href === '/crm/inbox' && pendingInbox > 0 ? { ...it, badge: pendingInbox } : it
  ))

  return (
    <MeetingModeProvider>
    <AppShell
      items={navItems}
      groups={NAV_GROUPS}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      // CRM 안에서는 CRM 을 찾는다 — 밖으로 데리고 나가지 않는다
      search={{ action: '/crm/search', placeholder: '회사·사람·딜 찾기…' }}
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

