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
 * 지금은 한 줄이다 — 한 화면에 쌓여 있던 것을 나누는 일은 다음 항목에서 한다.
 * 갈 곳을 먼저 만들어 두지 않는다: 빈 줄은 눌러 놓고 아무 일도 안 난다.
 */
export const TRADING_NAV: readonly TradingNavItem[] = [
  { href: '/trading', label: TRADING_NAV_LABEL.overview },
]
