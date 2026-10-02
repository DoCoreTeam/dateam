/**
 * 매매기준율 받아 두기 (SSOT) — 한국수출입은행 AP01 → `fx_rates` · `fx_rates_multi`
 *
 * **왜 이 파일이 생겼나**: 이 일을 하는 코드가 관리자 단추 하나(`POST /api/pricing/gpu/fx`)
 * 안에만 있었다. 그리고 그 단추를 누르는 것은 사람이 아니라 **화면이었다** —
 * `GpuPricingClient` 가 「관리자가 GPU 가격표를 그날 처음 열면」 한 번 쏜다.
 * 그래서 그 화면을 연 관리자가 없는 동안 환율이 멈춘다.
 *
 * 실측 2026-10-02: `fx_rates_multi` 의 통화 20종이 전부 `rate_date` 2026-09-14 에 서 있었다
 * (18일 묵음). 그 값으로 외화 원가를 환산하면서 화면은 그 날짜를 「고시일」이라 적어
 * **묵은 숫자를 근거처럼 보여 주고 있었다.** 환율이 묵는 것은 조용하다 — 숫자는 계속 나온다.
 *
 * 그래서 크론을 새로 만든다. 받는 일을 복붙하지 않고 이 함수 하나로 모으는 이유:
 * upsert 가 두 벌이면 한쪽만 고쳐지고, 그날부터 「사람이 누른 환율」과 「크론이 받은 환율」이
 * 갈린다. 어느 쪽이 맞는지 아무도 모르게 된다.
 *
 * **서비스롤을 쓴다**(`createAdminClient`). 환율표는 워크스페이스 밖의 공용 값이라
 * RLS 를 지나갈 세션이 없다. 그래서 맨 위가 `server-only` 다 — 이 모듈이 클라이언트
 * 번들에 섞이면 서비스롤 키가 함께 나간다(보안 S3).
 */
import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { parseKoraeximRows, type FxRateNormalized } from './fx-parse.ts'
import { fetchKoraeximJson } from './koreaexim.ts'

/** 휴일·미고시일을 건너뛰기 위해 거슬러 보는 날수 — 주말 둘 + 공휴일 하나 */
const MAX_FALLBACK_DAYS = 3

/**
 * 오늘부터 거슬러 올라가며 물어볼 날짜들 (KST, `YYYY-MM-DD`).
 *
 * **왜 KST 인가**: 고시 날짜는 서울 기준이다. 서버는 UTC 로 도니까 한국의 오늘이
 * UTC 의 어제인 시간대가 하루에 아홉 시간 있다. 그때 「오늘」을 UTC 로 물으면
 * 아직 고시되지 않은 날짜를 묻게 되고, 폴백이 하루를 헛돈다.
 *
 * 순수 함수다 — 바깥을 안 보므로 눈으로 검산할 수 있다.
 */
export function fxFallbackDates(now: Date, maxDays = MAX_FALLBACK_DAYS): string[] {
  const out: string[] = []
  for (let i = 0; i <= maxDays; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    // 'sv' 로케일이 YYYY-MM-DD 를 준다 — 직접 자르면 자리수 맞추는 코드가 또 생긴다
    out.push(d.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }))
  }
  return out
}

export interface FxSyncOk {
  ok: true
  /** 실제로 고시가 있던 날 — **물어본 날이 아니다**(휴일이면 직전 영업일) */
  rateDate: string
  usdKrw: number
  /** 받아서 저장한 통화 수 */
  currencies: number
  /**
   * 통화별 표(`fx_rates_multi`)까지 저장됐나.
   *
   * 이 값을 돌려주는 이유: supabase-js 는 upsert 오류를 **던지지 않고 반환한다.**
   * 예전 코드는 그 오류를 `console.error` 로만 흘려보냈고, 그러면 창구는 200 을 내면서
   * 다통화 환산은 계속 묵은 값을 쓴다 — **조용히 실패하는 자리**였다.
   */
  multiStored: boolean
  multiError: string | null
}

export interface FxSyncFail {
  ok: false
  reason: 'no_api_key' | 'no_quote' | 'store_failed'
  /** 사람이 읽을 사유 — 부르는 쪽이 자기 창구의 말로 싣는다 */
  message: string
}

/**
 * 매매기준율을 받아 두 표에 넣는다.
 *
 * **던지지 않는다.** 실패를 사유와 함께 돌려주고, 그 사유를 어떤 상태 코드로 바꿀지는
 * 부르는 쪽이 정한다 — 관리자 단추와 크론은 같은 사실을 서로 다른 말로 알려야 한다.
 */
export async function syncFxRates(now = new Date()): Promise<FxSyncOk | FxSyncFail> {
  const admin = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (admin as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.koreaexim_api_key === 'string' ? meta.koreaexim_api_key : ''
  if (!apiKey) {
    return {
      ok: false,
      reason: 'no_api_key',
      message: '환율 API 키가 설정되지 않았습니다 (관리자 설정에서 등록)',
    }
  }

  let rows: FxRateNormalized[] | null = null
  let rateDate = ''
  for (const date of fxFallbackDates(now)) {
    rows = await fetchOneDay(apiKey, date)
    if (rows !== null) { rateDate = date; break }
  }
  if (rows === null) {
    return { ok: false, reason: 'no_quote', message: '환율을 받지 못했습니다 (최근 4일 모두 고시 없음)' }
  }

  const usd = rows.find((r) => r.currency === 'USD')
  if (!usd) {
    // fetchOneDay 가 USD 있는 날만 통과시키므로 여기 올 수 없다 — 그래도 ! 로 눕히지 않는다
    return { ok: false, reason: 'no_quote', message: '환율을 받지 못했습니다 (USD 고시 없음)' }
  }

  /*
    두 표에 **둘 다** 넣는다. 앞의 것(`fx_rates`)은 GPU 판매가가 보고,
    뒤의 것(`fx_rates_multi`)은 CRM 다통화 환산이 본다.
    한쪽만 넣으면 같은 날의 환율을 두 화면이 다르게 말한다.
  */
  // @supabase/supabase-js 제네릭이 upsert 에서 never[] 로 붕괴하는 라이브러리 버그 — as any 불가피
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any

  const { error: usdErr } = await db
    .from('fx_rates')
    .upsert({ rate_date: rateDate, usd_krw: usd.krw_per_1, source: 'koreaexim' })
  if (usdErr) {
    return { ok: false, reason: 'store_failed', message: usdErr.message }
  }

  const { error: multiErr } = await db
    .from('fx_rates_multi')
    .upsert(
      rows.map((r) => ({
        rate_date: rateDate,
        currency: r.currency,
        per_unit: r.per_unit,
        deal_bas_krw: r.deal_bas_krw,
        krw_per_1: r.krw_per_1,
        source: 'koreaexim',
      })),
      // 유일 키는 `fx_rates_multi_pkey(rate_date, currency)` — 실측으로 확인했다
      { onConflict: 'rate_date,currency' },
    )

  return {
    ok: true,
    rateDate,
    usdKrw: usd.krw_per_1,
    currencies: rows.length,
    multiStored: !multiErr,
    multiError: multiErr ? multiErr.message : null,
  }
}

/**
 * 하루치 — **USD 가 있어야 유효한 고시일로 본다.**
 * 휴일·미고시일에는 빈 배열이 오므로 그것으로 「그날은 없다」를 판정한다.
 */
async function fetchOneDay(authKey: string, date: string): Promise<FxRateNormalized[] | null> {
  const json = await fetchKoraeximJson(authKey, date.replace(/-/g, ''))
  if (json == null) return null
  const parsed = parseKoraeximRows(json)
  return parsed.some((p) => p.currency === 'USD') ? parsed : null
}
