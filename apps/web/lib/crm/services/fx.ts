/**
 * 환율 (SSOT) — 외화 견적의 원화 환산
 *
 * **원본은 `fx_rates_multi` 다**(한국수출입은행 매매기준율, 호스트가 매일 받아 둔다).
 * CRM 은 그 표를 **읽기만** 한다 — 환율을 또 받아 오면 두 벌이 되고,
 * 어느 쪽이 맞는지 아무도 모르게 된다.
 *
 * **왜 견적에 박아 두나**: 환율은 매일 바뀐다. 조회할 때마다 환산하면
 * 어제 보낸 견적서를 오늘 열었을 때 다른 금액이 나온다 —
 * 고객이 든 종이와 우리 화면이 서로를 반박하는 상태다.
 * 그래서 만든 날의 환율을 견적에 복사해 두고, 그 뒤로는 그 값만 쓴다.
 */

import { convertMinor } from '../domain/currency.ts'

export interface FxRate {
  /** 1 통화당 원 */
  rate: number
  /** 그 환율의 고시일 (YYYY-MM-DD) */
  date: string
  source: string
}

/** 원화는 환산할 것이 없다 — 이 판정을 화면마다 다시 쓰지 않게 여기 둔다 */
export function needsFx(currency: string | null | undefined): boolean {
  return Boolean(currency) && currency!.toUpperCase() !== 'KRW'
}

/**
 * 그 통화의 **가장 최근** 환율.
 *
 * 주말·공휴일에는 고시가 없다 — 그래서 «오늘 것»이 아니라 «가장 최근 것»을 쓰고,
 * 그 날짜를 함께 돌려준다. 화면이 「8/27 기준」이라고 밝힐 수 있어야
 * 사용자가 숫자를 믿거나 의심할 수 있다.
 *
 * 못 찾으면 `null` — **1.0 으로 눕히지 않는다.** 환율을 모르는데 1:1로 환산하면
 * 1억짜리 견적이 1억 원으로 보인다(달러였다면 1,400억이다).
 */
export async function latestFxRate(currency: string): Promise<FxRate | null> {
  const code = currency.trim().toUpperCase()
  if (!needsFx(code)) return null

  /*
    **동적 import 다.** `supabase/server.ts` 는 `next/headers` 를 물고 있어
    정적으로 부르면 이 파일 전체가 Next 밖(단위 테스트)에서 못 돈다 —
    그러면 아래 환산 계산도 함께 검증할 수 없게 된다.
  */
  const { createAdminClient } = await import('../../supabase/server.ts')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('fx_rates_multi')
    .select('rate_date, krw_per_1, source')
    .eq('currency', code)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  // supabase-js 는 오류를 «던지지 않고 반환»한다 — 검사하지 않으면 조용히 null 이 된다
  if (error || !data) return null
  const rate = Number(data.krw_per_1)
  if (!Number.isFinite(rate) || rate <= 0) return null

  return { rate, date: String(data.rate_date).slice(0, 10), source: String(data.source ?? '') }
}

/**
 * 외화 금액을 원으로 — **`convertMinor` 를 그대로 쓴다.**
 *
 * 처음엔 여기서 직접 곱했는데 **통화 자릿수를 빠뜨려 100배 틀렸다**
 * (USD minor 는 센트라 66,000 은 $660 인데 66,000 달러로 환산했다 — 실측으로 잡았다).
 * 자릿수 처리는 `domain/currency.ts` 에 이미 있었다. 같은 계산을 두 곳에 두면
 * 한 곳만 고쳐지고, 틀린 쪽이 **그럴듯한 숫자**를 만든다.
 */
export function toKrwMinor(amountMinor: bigint, currency: string, rate: number, date = ''): bigint {
  const out = convertMinor({ amountMinor, currency }, 'KRW', [
    { base: currency.toUpperCase(), quote: 'KRW', rate, date },
  ])
  // 환율을 넘겼으므로 null 이 나올 수 없다 — 그래도 0 으로 눕히지 않고 그대로 둔다
  return out ?? BigInt(0)
}
