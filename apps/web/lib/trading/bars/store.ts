import 'server-only'

/**
 * 봉 저장 — **같은 봉을 두 번 넣어도 한 줄이다**
 *
 * 크론은 가끔 두 번 돈다(§4). 유일 키 `(contract_code, tf, bar_start_at)` 가 DB 에서 막고,
 * 여기서는 `upsert` 로 그 사실을 이용한다. 코드로 「이미 있나」를 먼저 묻지 않는다 —
 * 묻고 넣는 사이에 남이 넣으면 그 검사는 아무것도 안 막는다.
 *
 * **덮어쓸 때 `data_version` 을 올린다.** 늦게 온 값이 판단에 쓰인 값을 조용히 바꾸면
 * 「그때 무엇을 보고 판단했나」가 사라진다(§6.5).
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { MinuteBarInput, Timeframe } from './confirm.ts'

export interface SaveBarsInput {
  contractCode: string
  tf: Timeframe
  bars: readonly MinuteBarInput[]
  /** 봉이 마감된 것을 확인한 시각 */
  confirmedAt: Date
  source: 'kis' | 'import'
  /** 최우선 호가. 분봉 조회에는 없어서 호가 조회로 따로 받아 채운다 */
  quote?: { bestBid: number | null; bestAsk: number | null }
  openInterest?: number | null
}

const TF_MINUTES: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 15 }

export async function saveBars(input: SaveBarsInput): Promise<{ saved: number }> {
  if (input.bars.length === 0) return { saved: 0 }
  const spanMs = TF_MINUTES[input.tf] * 60_000
  const confirmedAt = input.confirmedAt.toISOString()

  const rows = input.bars.map((bar) => ({
    contract_code: input.contractCode,
    tf: input.tf,
    bar_start_at: bar.startAt.toISOString(),
    bar_close_at: new Date(bar.startAt.getTime() + spanMs).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    open_interest: input.openInterest ?? null,
    best_bid: input.quote?.bestBid ?? null,
    best_ask: input.quote?.bestAsk ?? null,
    confirmed_at: confirmedAt,
    // 이 값을 알 수 있게 된 시각. 확정 확인 시각과 같다 — 그 전에는 존재하지 않았다(§6.5)
    available_at: confirmedAt,
    source: input.source,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_bars')
    .upsert(rows, { onConflict: 'contract_code,tf,bar_start_at', ignoreDuplicates: true })
  // supabase-js 는 쓰기 오류를 던지지 않고 돌려준다. 안 보면 0건 저장이 성공으로 보인다
  if (error) throw new Error(`봉을 저장하지 못했습니다: ${error.message}`)
  return { saved: rows.length }
}

/**
 * 판단이 읽는 봉 — **기준 시각 이전에 알 수 있던 것만**(M5).
 *
 * 기준 시각을 인자로 받는 이유가 이것이다. 「최근 N개」로 물으면 백테스트가
 * 그 시점에 몰랐던 봉을 보게 되고, 그 성적은 실시간에 재현되지 않는다.
 */
export async function loadBarsAsOf(input: {
  contractCode: string
  tf: Timeframe
  asOf: Date
  limit: number
}): Promise<MinuteBarInput[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_bars')
    .select('bar_start_at, open, high, low, close, volume')
    .eq('contract_code', input.contractCode)
    .eq('tf', input.tf)
    .lte('available_at', input.asOf.toISOString())
    .order('bar_start_at', { ascending: false })
    .limit(input.limit)
  if (error) throw new Error(`봉을 읽지 못했습니다: ${error.message}`)

  return ((data ?? []) as Record<string, string | number>[])
    .map((row) => ({
      startAt: new Date(String(row.bar_start_at)),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }))
    .reverse()
}

/** 그날 이 월물의 1분 봉이 몇 개나 있나. 화면이 결측 구간을 세는 자리 */
export async function countBarsBetween(input: {
  contractCode: string
  tf: Timeframe
  from: Date
  to: Date
}): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count, error } = await admin
    .from('trading_bars')
    .select('bar_start_at', { count: 'exact', head: true })
    .eq('contract_code', input.contractCode)
    .eq('tf', input.tf)
    .gte('bar_start_at', input.from.toISOString())
    .lt('bar_start_at', input.to.toISOString())
  if (error) throw new Error(`봉 수를 세지 못했습니다: ${error.message}`)
  return count ?? 0
}
