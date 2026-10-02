// POST /api/pricing/gpu/fx — 관리자가 매매기준율을 지금 받아 온다
// GET  /api/pricing/gpu/fx — 최근 7일치 USD 환율
//
// **받아 오는 일은 여기 없다.** `lib/gpu/fx-sync.ts` 한 곳에 있고 이 단추와
// 날마다 도는 크론(`/api/cron/fx-sync`)이 **같은 함수**를 부른다.
// 복붙해 두면 한쪽만 고쳐지고, 그날부터 「사람이 누른 환율」과 「크론이 받은 환율」이
// 갈린다 — 어느 쪽이 맞는지 아무도 모르게 된다.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { syncFxRates } from '@/lib/gpu/fx-sync'

/** 사유 → 상태 코드. 크론(`/api/cron/fx-sync`)과 **같은 사실을 같은 코드로** 말한다 */
const STATUS: Record<'no_api_key' | 'no_quote' | 'store_failed', number> = {
  no_api_key: 500,
  no_quote: 502,
  store_failed: 500,
}

export async function POST() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const r = await syncFxRates()
  if (!r.ok) {
    return NextResponse.json({ error: r.message }, { status: STATUS[r.reason] })
  }

  /*
    **통화별 표가 안 들어갔으면 알린다.** 예전에는 그 오류를 `console.error` 로만 흘리고
    200 을 냈다 — 누른 사람은 「됐다」고 보고 돌아가는데 CRM 다통화 환산은 계속 묵은 값을 썼다.
    USD 는 들어갔으므로 날짜를 함께 돌려준다(다시 눌러도 같은 날짜로 덮어쓸 뿐이다).
  */
  if (!r.multiStored) {
    return NextResponse.json(
      { error: r.multiError ?? '통화별 환율을 저장하지 못했습니다.', rate_date: r.rateDate },
      { status: 500 },
    )
  }

  // 환율 변경은 sell_price_krw 전체에 영향 → 4탭 캐시 무효화 (stale 방지)
  revalidateGpu()

  return NextResponse.json({ rate_date: r.rateDate, usd_krw: r.usdKrw, currencies: r.currencies })
}

export async function GET() {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('fx_rates')
      .select('*')
      .order('rate_date', { ascending: false })
      .limit(7)

    if (error) throw error

    return NextResponse.json({ rates: data ?? [] })
  } catch (err) {
    console.error('[pricing/fx GET]', err)
    return NextResponse.json({ error: 'Failed to fetch FX rates' }, { status: 500 })
  }
}
