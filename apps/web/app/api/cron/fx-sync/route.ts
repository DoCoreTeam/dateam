// GET/POST /api/cron/fx-sync — 매매기준율을 날마다 받아 둔다
//
// **왜 이 창구가 생겼나**: 받아 두는 코드가 관리자 단추(`POST /api/pricing/gpu/fx`) 안에만
// 있었다. 더 나쁜 것은 **그 단추를 누르는 것이 사람이 아니었다는 것**이다 —
// `GpuPricingClient` 가 「관리자가 그날 GPU 가격표를 처음 열면」 한 번 쏜다.
// 그래서 그 화면을 연 관리자가 없는 날은 환율이 그 자리에 선다.
//
// 실측 2026-10-02: `fx_rates_multi` 의 통화 20종이 전부 `rate_date` 2026-09-14 였다(18일 묵음).
// 그 값으로 외화 원가를 환산하면서 원가 화면은 그 날짜를 「고시일」이라 적고 있었다 —
// **묵은 숫자가 근거의 모습을 하고 있었다.** 환율이 묵는 것은 조용하다, 숫자는 계속 나온다.
//
// **GET 과 POST 를 둘 다 연다.** Vercel 크론은 GET 으로 부른다 —
// POST 만 열어 뒀다가 8시간 내내 403 이 난 전례가 있다(v0.7.572).

import { NextResponse } from 'next/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { syncFxRates } from '@/lib/gpu/fx-sync'
import { revalidateGpu } from '@/lib/gpu/revalidate'

export const dynamic = 'force-dynamic'

/** 실패 사유 → 상태 코드. 부르는 쪽이 「내 탓인가 남의 탓인가」를 코드만 보고 알아야 한다 */
const STATUS: Record<'no_api_key' | 'no_quote' | 'store_failed', number> = {
  no_api_key: 503,   // 우리 설정이 빠졌다 — 고치면 되는 것
  no_quote: 502,     // 바깥(한국수출입은행)이 안 줬다 — 기다리면 되는 것
  store_failed: 500, // 우리 저장이 실패했다 — 봐야 하는 것
}

async function sync(req: Request) {
  /*
    **토큰이 없으면 창구를 열지 않는다.** 「설정 안 됨 = 무인증 통과」로 두면
    전 워크스페이스 공용 표에 쓰는 자리가 인터넷에 열린다.
    이 라우트는 서비스롤로 쓴다(`fx-sync.ts` 가 `createAdminClient`) — RLS 를 통째로 지나가므로
    그 위를 막는 것은 여기 이 두 줄뿐이다.
  */
  if (machineAuthUnconfigured()) {
    return NextResponse.json({ error: '크론 인증이 설정되지 않았습니다.' }, { status: 503 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const r = await syncFxRates()
  if (!r.ok) {
    return NextResponse.json({ error: r.message, reason: r.reason }, { status: STATUS[r.reason] })
  }

  /*
    **통화별 표가 안 들어갔으면 200 을 내지 않는다.**
    예전 단추는 그 오류를 `console.error` 로만 흘리고 200 을 냈다. 그러면 크론은 날마다
    「됐다」고 답하면서 CRM 다통화 환산은 계속 묵은 값을 쓴다 — 조용히 실패하는 자리다.
  */
  if (!r.multiStored) {
    return NextResponse.json(
      { error: r.multiError ?? '통화별 환율을 저장하지 못했습니다.', reason: 'store_failed', rate_date: r.rateDate },
      { status: 500 },
    )
  }

  // 환율은 sell_price_krw 전체에 걸린다 — 안 지우면 화면이 어제 값을 그대로 그린다
  revalidateGpu()

  return NextResponse.json({
    ok: true,
    rate_date: r.rateDate,
    usd_krw: r.usdKrw,
    currencies: r.currencies,
  })
}

export async function GET(req: Request) { return sync(req) }
export async function POST(req: Request) { return sync(req) }
