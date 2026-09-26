import 'server-only'

/**
 * AI 트레이딩 소유자 지정 — **소유자를 정하는 일은 소유자 문 밖에 있어야 한다**
 *
 * ## 왜 생겼나 (실측 2026-09-26)
 *
 * `decideTradingAccess` 는 `owner_user_id` 가 비면 **아무도** 안 들여보낸다. 그 판단은 옳다 —
 * 「아직 안 정했다」는 「아무나 봐도 된다」가 아니다. 그런데 그 값을 바꾸는 유일한 자리가
 * `/trading` 안에 있었다. 비어 있으면 그 화면에 못 들어가고, 못 들어가면 값을 못 정한다.
 * 관리자가 접근권한을 부여해도 소용이 없었다 — 부여는 **표면 문**을 열 뿐이고
 * 소유자 문은 그 위에 따로 서 있다(`lib/trading/access.ts`).
 *
 * psql 로 재 보니 `access_grant` 에 trading→관리자 allow 한 줄이 이미 있었고
 * `trading_settings.owner_user_id` 는 `''` 였다. 문 두 개 중 하나만 연 것이다.
 *
 * 그래서 지정은 **접근권한 화면**(관리자 전용)에서 한다. 소유자 문 밖이고 관리자만 닿는다.
 *
 * ## 왜 오늘부터인가
 *
 * 설정은 대개 다음 거래일부터 듣는다(§15.2). 소유자는 전략 값이 아니라 **문**이다.
 * 다음 거래일부터로 두면 관리자가 지정하고도 오늘은 못 들어간다 — 그것은 고친 것이 아니다.
 * 즉시 적용이 허용되는 쪽(신호를 막는 쪽·문을 여닫는 쪽)에 속한다.
 *
 * ## 서비스롤을 쓰는 이유
 *
 * `trading_settings` 와 `profiles` 는 정책으로 잠겨 있다. 사람 확인은 창구
 * (`app/api/admin/trading-owner/route.ts`)의 `requireAdminApi` 가 하고,
 * 여기는 그 확인을 지난 뒤에만 불린다(LOOP.md 7절 S2).
 */

import { createAdminClient } from '@/lib/supabase/server'
import { kstTodayKey } from '@/lib/datetime/kst'
import { loadTradingSettings, saveTradingSetting } from './settings/store.ts'

/** 설정 레지스트리에서 소유자를 담는 키. 화면·창구·판정이 같은 글자를 쓴다 */
export const TRADING_OWNER_KEY = 'owner_user_id'

/**
 * 이 소유자가 지키는 표면 키(`lib/access/surfaces.ts`).
 *
 * 접근권한 화면이 **어느 줄에** 소유자 칸을 세울지를 여기서 받는다. 화면이 `'trading'` 을
 * 직접 적으면 표면 키를 바꾸는 날 칸이 조용히 사라진다 — 사라진 자리는 오류를 안 낸다.
 */
export const TRADING_OWNER_SURFACE = 'trading'

export interface TradingOwner {
  /** 빈 문자열이면 아직 아무도 아니다 — 그때는 관리자도 못 들어간다 */
  userId: string
  /** 화면에 그릴 이름. 지워진 사람을 가리키고 있으면 null 이다 */
  name: string | null
}

/**
 * 지금 소유자.
 *
 * 이름을 함께 돌려주는 이유: 화면이 id 만 받으면 `f687c53a…` 를 그리게 되고,
 * 관리자는 그것이 누구인지 확인하려고 다른 화면을 열어야 한다.
 */
export async function loadTradingOwner(): Promise<TradingOwner> {
  const { values } = await loadTradingSettings(kstTodayKey())
  const userId = String(values[TRADING_OWNER_KEY] ?? '').trim()
  if (userId === '') return { userId: '', name: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  /**
   * 행이 없으면 **이름을 지어내지 않는다.** 소유자로 적힌 사람이 지워졌다는 사실이
   * 화면에 드러나야 관리자가 다시 지정한다. id 를 이름 자리에 넣으면 그 사실이 숨는다.
   */
  return { userId, name: (data?.name as string | null) ?? null }
}

export type SetOwnerResult =
  | { ok: true; owner: TradingOwner }
  | { ok: false; message: string }

/**
 * 소유자를 바꾼다. 빈 문자열이면 **아무도 아닌 상태로** 되돌린다.
 *
 * @param userId 새 소유자의 `profiles.id`. 빈 문자열이면 해제
 * @param actorId 바꾸는 관리자. `changed_by` 와 사유 줄에 남는다
 */
export async function setTradingOwner(userId: string, actorId: string): Promise<SetOwnerResult> {
  const next = userId.trim()
  // 바꾸기 전 값을 먼저 잡는다 — 판에 이전 값이 안 적히면 「무엇이 무엇으로 바뀌었나」를
  // 두 줄을 나란히 놓고 사람이 짐작해야 한다. 짐작은 감사 기록이 아니다
  const before = await loadTradingOwner()

  let name: string | null = null
  if (next !== '') {
    /**
     * **밖에서 온 값은 실제 행과 대조한 뒤에만 저장한다.**
     * 안 맞춰 보면 오타 하나가 「아무도 아닌 소유자」가 되고, 그 상태는 화면에서
     * 「지정됨」으로 보이면서 아무도 못 들어간다 — 지금 고치고 있는 바로 그 상태다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('profiles')
      .select('id, name')
      .eq('id', next)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return { ok: false, message: '구성원을 확인하지 못해 저장을 멈췄습니다' }
    if (!data) return { ok: false, message: '그 구성원을 찾지 못했습니다' }
    name = (data.name as string | null) ?? null
  }

  const saved = await saveTradingSetting({
    key: TRADING_OWNER_KEY,
    value: next,
    source: 'admin',
    // 누가(changed_by)·언제(changed_at)는 표의 칼럼이 들고, 여기에는 **무엇이 무엇으로**를 적는다
    reason: ownerChangeReason(before.userId, next),
    changedBy: actorId,
    // 문이라 오늘부터다 (위 주석)
    effectiveTradeDate: kstTodayKey(),
  })
  if (!saved.ok) return { ok: false, message: saved.rejection.userMessage }

  return { ok: true, owner: { userId: next, name } }
}

/**
 * 판에 남길 한 줄. 이전 값과 새 값을 둘 다 적는다.
 *
 * 누가·언제는 `changed_by`·`changed_at` 칼럼이 들고 있으므로 여기서 되풀이하지 않는다 —
 * 같은 사실을 두 자리에 적으면 한쪽만 고쳐지는 날이 온다.
 */
function ownerChangeReason(before: string, next: string): string {
  const from = before === '' ? '없음' : before
  if (next === '') return `접근권한 화면에서 소유자 해제 (${from} -> 없음)`
  return `접근권한 화면에서 소유자 지정 (${from} -> ${next})`
}
