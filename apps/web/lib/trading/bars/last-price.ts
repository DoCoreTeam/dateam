import 'server-only'

/**
 * 마지막 현재가 한 줄 — **형성 중인 봉이 읽는 값**
 *
 * ## 왜 저장하나
 *
 * 실측 2026-09-29: tick 이 매분 `futs_prpr` 를 받아 쓰고 **버렸다**. 저장하는 자리가
 * 없어 화면은 봉이 확정될 때만 바뀌었고, 맨 오른쪽 봉이 실시간으로 모양을 바꾸는
 * 길이 없었다.
 *
 * ## 못 받은 분에는 안 덮어쓴다
 *
 * 조회가 실패한 분에 null 로 덮으면 화면이 「값 없음」으로 깜빡인다. 마지막으로 성공한
 * 값이 남아 있어야 하고, **그 값이 언제 것인지**(`observedAt`)를 화면이 말하면 된다 —
 * 오래된 값은 화면이 안 그리면 된다(그 판정은 화면 몫이다).
 */

import { createAdminClient } from '@/lib/supabase/server'

export interface LastPrice {
  contractCode: string
  price: number
  /** 언제 받은 값인가 (ISO) */
  observedAt: string
}

/** 숫자가 아니면 null — `Number(null)` 도 `Number('')` 도 0 이라 그대로 통과시키면 0원짜리 값이 남는다 */
function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 받은 현재가를 남긴다. **값이 없으면 아무것도 안 한다.**
 *
 * 던지지 않는다 — 현재가 한 줄 때문에 크론 한 판이 죽으면 봉 수집까지 멈춘다.
 * 실패는 돌려주는 사유로 알린다.
 */
export async function saveLastPrice(
  contractCode: string,
  price: unknown,
  observedAt: Date,
): Promise<{ saved: boolean; reason: string }> {
  const value = finite(price)
  // 못 받은 분에는 안 덮어쓴다. 마지막으로 성공한 값이 남아야 한다
  if (value === null) return { saved: false, reason: 'no_price' }
  if (!contractCode) return { saved: false, reason: 'no_contract' }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // supabase-js 는 쓰기 오류를 던지지 않고 돌려준다. 안 보면 0건 저장이 성공으로 보인다
    const { error } = await admin.from('trading_last_price').upsert({
      contract_code: contractCode,
      price: value,
      observed_at: observedAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contract_code' })
    if (error) return { saved: false, reason: `write_failed:${error.message}` }
    return { saved: true, reason: '' }
  } catch (error) {
    return { saved: false, reason: error instanceof Error ? error.message : 'unknown' }
  }
}

/** 마지막 현재가. 없거나 못 읽으면 null — 지어내지 않는다 */
export async function loadLastPrice(contractCode: string | null): Promise<LastPrice | null> {
  if (!contractCode) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('trading_last_price')
      .select('contract_code, price, observed_at')
      .eq('contract_code', contractCode)
      .maybeSingle()
    if (error || !data) return null
    const price = finite(data.price)
    if (price === null) return null
    return { contractCode: data.contract_code, price, observedAt: String(data.observed_at) }
  } catch {
    return null
  }
}
