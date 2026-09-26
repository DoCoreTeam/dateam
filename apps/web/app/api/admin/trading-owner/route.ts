import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { setTradingOwner } from '@/lib/trading/owner-admin'

/**
 * AI 트레이딩 소유자 지정 창구 — **관리자만** (LOOP.md 7절 S2)
 *
 * ## 왜 소유자 문 밖에 있나
 *
 * 소유자를 정하는 화면이 `/trading` 안에 있었다. 그런데 소유자가 비어 있으면
 * `decideTradingAccess` 가 **아무도** 안 들여보낸다 — 값을 정해야 들어가는데
 * 들어가야 값을 정할 수 있었다. 그래서 그 값만 여기, 관리자 화면 쪽으로 꺼낸다.
 *
 * ## 왜 사람 확인이 먼저인가
 *
 * 밑에서 도는 것은 `createAdminClient` 다. 서비스롤은 RLS 를 통째로 지나가고
 * `trading_settings` 는 정책 0개로 잠겨 있다(마이그 279) — 즉 이 창구가 유일한 문이다.
 * `requireAdminApi` 가 없으면 로그인한 아무나 자기를 소유자로 적을 수 있고,
 * 그 순간 남의 매매 판단 기록이 열린다.
 *
 * 값 검사는 여기 적지 않는다. `setTradingOwner` 가 `profiles` 실제 행과 대조하는 한 벌이고,
 * 창구가 따로 검사하면 두 벌이 되어 한쪽만 고쳐지는 날이 온다.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '본문을 읽지 못했습니다' }, { status: 400 })
  }

  /**
   * 밖에서 오는 값은 이것 하나다. 빈 문자열이면 **해제**이므로 없다고 막지 않는다 —
   * 막으면 잘못 지정한 소유자를 되돌릴 길이 사라진다.
   */
  const userId = String((body as Record<string, unknown>).userId ?? '')

  const result = await setTradingOwner(userId, auth.user.id)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
  return NextResponse.json({ ok: true, owner: result.owner })
}
