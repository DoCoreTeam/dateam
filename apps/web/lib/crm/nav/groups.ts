// lib/crm/nav/groups.ts — CRM 메뉴 묶음의 단일 구현(SSOT)
//
// 왜 생겼나 (기획 `docs/2026-08-27-crm-capture-first/01-SCENARIO.md` 설계 3):
//   사이드바 항목이 13개였다. 사용자 지적(2026-08-27):
//   *"현재 CRM에 메뉴가 상당히 많은데 연관성 있는건 묶는 작업이 되었는지 모르겠고"* ·
//   *"메뉴가 너무 많은것도 문제야"*.
//
//   실측하면 더 분명하다 — 13개 중 **딜 0건 · 견적 0건 · 할 일 0건**이다(운영 DB 2026-08-27).
//   매일 여는 것과 아직 비어 있는 것이 **같은 무게로** 늘어서 있어서,
//   목록이 길어질수록 정작 매일 여는 것이 눈에 안 들어온다.
//
// **화면을 없애지 않는다. 탭으로 내린다.**
//   라우트 20개는 그대로 산다. 북마크·공유 링크·뒤로가기가 전부 살아 있다.
//   바뀌는 것은 **어디서 그 화면으로 들어가느냐** 하나다.
//
// 이 파일이 유일한 자리인 이유: 사이드바(`(crm)/layout.tsx`)와 각 화면의 탭바가
// **같은 표**를 읽어야 한다. 두 곳에 적으면 하나를 고칠 때 다른 하나가 남아
// "사이드바에선 「거래처」인데 화면에선 「회사」"가 된다(§2-3-3 N-4).

export interface CrmGroupTab {
  href: string
  label: string
}

export interface CrmNavGroup {
  /** 사이드바에 뜨는 묶음 이름 */
  label: string
  /** 묶음을 눌렀을 때 가는 곳 — 첫 탭 */
  href: string
  /** 이 묶음에 속한 화면들. 2개 이상일 때만 탭바가 뜬다(§2-3-3 N-3) */
  tabs: CrmGroupTab[]
}

/**
 * 묶음 다섯. 순서는 **하루에 여는 횟수**다 — 데이터 모델 순서가 아니다.
 *
 * 「거래처」가 묶음 이름이고 개체 이름은 「회사」다 — 용어집이 그렇게 정했고 섞지 않는다
 * (`lib/terms/entity.ts`).
 */
export const CRM_NAV_GROUPS: readonly CrmNavGroup[] = [
  {
    // 인박스를 흡수한다. 둘 다 "지금 봐야 할 것"이고, 인박스를 따로 두면
    // 안 열어 보는 사이에 제안이 만료된다(그래서 지금 배지를 달고 있다).
    label: '오늘',
    href: '/crm/today',
    tabs: [
      { href: '/crm/today', label: '오늘' },
      { href: '/crm/inbox', label: '제안' },
    ],
  },
  {
    // 견적은 딜 금액의 **근거 문서**다. 코드 주석도 그렇게 써 놓고 메뉴만 따로 뒀다.
    label: '딜',
    href: '/crm/deals',
    tabs: [
      { href: '/crm/deals', label: '딜' },
      { href: '/crm/quotes', label: '견적' },
      // 품목은 견적의 **재료**다. 설정으로 내리면 견적 쓰다가 오타를 발견해도
      // 고치러 갈 길이 안 보인다 — 실제로 고칠 화면 자체가 없었다(사용자 지적)
      { href: '/crm/products', label: '품목' },
    ],
  },
  {
    // 같은 것의 두 면. 영업은 "○○전자의 배수현"을 찾지 "인물 목록"을 찾지 않는다.
    label: '거래처',
    href: '/crm/companies',
    tabs: [
      { href: '/crm/companies', label: '회사' },
      { href: '/crm/people', label: '인물' },
    ],
  },
  {
    // 전부 "무슨 일이 있었나"다. 변경 이력이 「보기」에 따로 있을 이유가 없다.
    label: '기록',
    href: '/crm/meetings',
    tabs: [
      { href: '/crm/meetings', label: '미팅' },
      { href: '/crm/tasks', label: '할 일' },
      { href: '/crm/audit', label: '변경 이력' },
    ],
  },
  {
    // 혼자짜리 묶음은 만들지 않는다(§2-3-3 N-3) — 탭이 하나면 탭바가 안 뜬다.
    label: '리포트',
    href: '/crm/reports',
    tabs: [{ href: '/crm/reports', label: '리포트' }],
  },
]

/**
 * 계정 메뉴로 내려가는 것들.
 *
 * 처음 한 번 정하고 가끔 손보는 것이다. 매일 쓰는 것 옆에 두면 매일 쓰는 것이 안 보인다.
 * **지우는 게 아니라 옮기는 것** — 링크는 그대로 살아 있다.
 */
export const CRM_ACCOUNT_ITEMS: readonly CrmGroupTab[] = [
  { href: '/crm/process', label: '영업 단계' },
  { href: '/crm/members', label: '멤버' },
  { href: '/crm/settings', label: '설정' },
]

/**
 * 이 경로가 속한 묶음을 찾는다.
 *
 * 상세 경로(`/crm/companies/abc`)도 목록과 같은 묶음으로 본다 — 그래야 상세에 들어가도
 * 사이드바의 같은 자리가 켜진 채로 남는다.
 */
/** 설정 3개도 한 묶음이다 — 사이드바엔 없지만 서로 탭으로 이어진다 */
const CRM_SETTINGS_GROUP: CrmNavGroup = {
  label: '영업 CRM 설정',
  href: '/crm/settings',
  tabs: [
    { href: '/crm/settings', label: '설정' },
    { href: '/crm/process', label: '영업 단계' },
    { href: '/crm/members', label: '멤버' },
  ],
}

export function crmGroupOf(pathname: string): CrmNavGroup | null {
  for (const g of [...CRM_NAV_GROUPS, CRM_SETTINGS_GROUP]) {
    if (g.tabs.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))) return g
  }
  return null
}

/** 사이드바가 켤 자리를 정할 때 쓰는 경로 목록(묶음 하나가 여러 경로를 대표한다) */
export function crmGroupMatchPaths(g: CrmNavGroup): string[] {
  return g.tabs.map((t) => t.href)
}
