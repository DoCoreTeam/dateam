/**
 * RFP 분석기 사이드바 (SSOT)
 *
 * 레이아웃과 화면이 **같은 표**를 읽어야 갈리지 않는다
 * (`lib/crm/nav/groups.ts`·`lib/ai-chat/nav/groups.ts` 와 같은 이유).
 *
 * **아이콘은 여기 없다** — 표면마다 크기가 달라 화면이 정한다.
 */

import { RFP_NAV } from '../terms.ts'

export interface RfpNavItem {
  href: string
  label: string
  /** 이 경로 아래에 있어도 이 자리가 켜져 있어야 한다 */
  match?: string[]
  /** 관리자만 보이는 자리 */
  adminOnly?: boolean
}

export interface RfpNavGroup {
  label: string
  items: RfpNavItem[]
}

/**
 * 묶음 셋. 순서는 **하루에 여는 횟수**다.
 *
 * 「분석」이 먼저인 이유: 이 서비스를 여는 사람이 가장 자주 하는 일이 공고를 읽는 것이다.
 * 「준비」는 회사 정보와 레이더라 자주는 아니지만 없으면 분석이 얕아진다.
 * 「그 밖」은 하루에 한 번도 안 여는 것들이다.
 */
export const RFP_NAV_GROUPS: readonly RfpNavGroup[] = [
  {
    label: '분석',
    items: [
      { href: '/rfp', label: RFP_NAV.cases, match: ['/rfp/cases'] },
      { href: '/rfp/new', label: RFP_NAV.newCase },
      { href: '/rfp/assistant', label: RFP_NAV.assistant },
    ],
  },
  {
    label: '준비',
    items: [
      { href: '/rfp/radar', label: RFP_NAV.radar },
      { href: '/rfp/profile', label: RFP_NAV.profile },
    ],
  },
  {
    label: '그 밖',
    items: [
      { href: '/rfp/admin', label: RFP_NAV.admin, adminOnly: true },
    ],
  },
]

/** 이 자리가 켜져 있어야 하는 경로들 — 첫 값이 자기 주소다 */
export function rfpNavMatchPaths(item: RfpNavItem): string[] {
  return [item.href, ...(item.match ?? [])]
}

/** 역할에 맞는 메뉴만 */
export function rfpNavFor(isAdmin: boolean): RfpNavGroup[] {
  return RFP_NAV_GROUPS
    .map((g) => ({ label: g.label, items: g.items.filter((i) => !i.adminOnly || isAdmin) }))
    .filter((g) => g.items.length > 0)
}
