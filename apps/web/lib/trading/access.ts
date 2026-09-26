import 'server-only'

/**
 * 트레이딩 문 — 지금 요청이 소유자인가
 *
 * 판정 자체는 `access-decide.ts` 에 있고 여기는 **값을 가져다 대는 자리**다.
 * 화면(레이아웃)과 창구(API)가 둘 다 여기를 부른다 — 두 곳이 각자 판정하면 갈리고,
 * 갈린 결과가 「화면은 열리는데 창구가 403」 이거나 그 반대다.
 */

import { cache } from 'react'
import { getRequestUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { pickEffective } from './settings/pick-effective.ts'
import type { EffectiveRow } from './settings/pick-effective.ts'
import { decideTradingAccess, type TradingAccessDecision } from './access-decide.ts'

export type { TradingAccessDecision, TradingAccessReason } from './access-decide.ts'

/**
 * 소유자 ID 하나만 읽는다.
 *
 * 설정 전체(`loadTradingSettings`)를 쓰지 않는 이유: 문을 여는 데 필요한 것은 한 줄인데
 * 전체를 읽으면 문 하나 여는 비용이 설정 개수에 비례해 늘어난다. 그리고 문은 요청마다 선다.
 *
 * 왜 오늘 날짜로 고르나: 유효일이 아직 안 온 판은 아직 값이 아니기 때문이다.
 *
 * **소유자는 그중 예외다** (2026-09-26). 다른 설정은 다음 거래일부터 듣지만 소유자는
 * 전략 값이 아니라 **문**이라 그날 바로 듣는다. 다음 거래일부터로 두면 관리자가 지정하고도
 * 그날은 아무도 못 들어가고, 그건 지정을 안 한 것과 화면에서 구별되지 않는다.
 * 그래서 `lib/trading/owner-admin.ts` 가 **오늘 날짜로** 판을 쌓는다 — 여기 걸리는 조건은
 * 그대로 두고 쓰는 쪽이 날짜를 정한다.
 */
async function readOwnerUserId(todayIso: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_settings')
    .select('key, value, version, effective_trade_date')
    .eq('key', 'owner_user_id')
    .lte('effective_trade_date', todayIso)

  // 못 읽었으면 「소유자 없음」으로 넘어가지 않는다 — 그러면 읽기 장애가 조용한 차단이 된다
  if (error) throw new Error(`트레이딩 소유자를 읽지 못했습니다: ${error.message}`)

  const row = pickEffective((data ?? []) as EffectiveRow[], todayIso).get('owner_user_id')
  return row ? String(row.value) : null
}

/** 서울 기준 오늘. 설정 유효일이 날짜라 시각이 아니라 날짜로 비교한다 */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/**
 * 한 요청 안에서는 한 번만 묻는다 — 레이아웃과 창구가 각각 불러도 왕복은 하나다.
 * (`getRequestUser` 도 같은 이유로 `cache()` 로 싸여 있다)
 */
export const tradingAccess = cache(async (): Promise<TradingAccessDecision> => {
  const user = await getRequestUser()
  if (!user) return decideTradingAccess({ userId: null, isAdmin: false }, null)

  const ownerUserId = await readOwnerUserId(todayInSeoul())
  /**
   * `isAdmin` 을 굳이 넘기지 않는다. 판정이 안 쓰는 값을 넘기면 다음 사람이
   * 「관리자는 통과하겠지」로 읽는다 — 읽는 사람의 짐작이 규칙이 되면 안 된다.
   */
  return decideTradingAccess({ userId: user.id, isAdmin: false }, ownerUserId)
})

/** 소유자인가만 묻고 싶을 때 */
export async function isTradingOwner(): Promise<boolean> {
  return (await tradingAccess()).allowed
}
