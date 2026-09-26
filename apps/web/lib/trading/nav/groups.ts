/**
 * AI 트레이딩 사이드바 목록 — **한 곳에서만 정한다** (§2-3-3 N-4)
 *
 * 셸(`app/(trading)/layout.tsx`)은 이 표를 펴서 **그림만** 붙인다. 화면이 자기 목록을 따로
 * 들면 그 순간 두 벌이 되고, 화면을 하나 더 만들 때 한쪽만 고쳐진다 — 호스트 사이드바가
 * 정확히 그렇게 갈렸고 그래서 `lib/nav/menu.ts` 가 생겼다.
 * 영업 CRM 도 같은 모양이다(`lib/crm/nav/groups.ts`).
 *
 * **이름도 여기서 안 짓는다.** 화면에 뜨는 말은 `lib/terms` 를 지난다.
 */

import { TRADING_NAV_LABEL } from '../../terms/index.ts'

export interface TradingNavItem {
  href: string
  label: string
  /** 이 자리를 켜 둘 추가 경로. 하위 화면에 들어가도 사이드바에서 자리를 잃지 않게 */
  match?: readonly string[]
}

/**
 * 순서는 **여는 빈도**다. 매일 보는 것이 위, 처음 한 번 정하는 것이 아래.
 *
 * 왜 나눴나 (사용자 지적 2026-09-27: 「지금 화면 스크롤은 너무 과한데?」):
 * 한 장에 패널 12개 + 최근 실행 + 설정 묶음 15개(값 88개)가 세로로 쌓여 있었다.
 * 매일 보는 신호 세 줄을 보려고 그 전부를 스크롤로 지나야 했다.
 *
 * 묶음(`groups`)을 안 만든다 — 일곱이면 머리글 없이 한눈에 들어오고,
 * 항목이 둘뿐인 묶음에 이름을 붙이면 이름이 항목보다 많아진다(§2-3-3 N-3).
 */
export const TRADING_NAV: readonly TradingNavItem[] = [
  { href: '/trading', label: TRADING_NAV_LABEL.overview },
  { href: '/trading/judgments', label: TRADING_NAV_LABEL.judgments },
  { href: '/trading/validation', label: TRADING_NAV_LABEL.validation },
  { href: '/trading/operations', label: TRADING_NAV_LABEL.operations },
  { href: '/trading/data', label: TRADING_NAV_LABEL.data },
  { href: '/trading/knowledge', label: TRADING_NAV_LABEL.knowledge },
  { href: '/trading/settings', label: TRADING_NAV_LABEL.settings },
]
