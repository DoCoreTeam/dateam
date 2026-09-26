import 'server-only'

/**
 * SG-01 이 볼 둘을 실제로 잰다 — 평소 호가 폭과 마지막 봉
 *
 * ## 왜 이 파일이 따로 있나
 *
 * `measure.ts` 는 실행 기록·보정·증거금·AI 예산을 본다. 그것들은 「우리 쪽이 멀쩡한가」다.
 * 여기 둘은 「시장에서 온 값이 멀쩡한가」다. 같은 파일에 넣으면 한쪽이 실패했을 때
 * 다른 쪽까지 못 재고, **못 잰 게이트는 안 걸리는 게이트다.**
 *
 * ## 기준선은 우리가 이미 모은 것에서 나온다
 *
 * 스프레드 기준선을 새로 모으지 않는다. `trading_bars` 가 봉마다 최우선 호가를
 * 이미 적고 있다(마이그 279). 새 표를 만들면 그 표가 비는 날 게이트가 또 멈춘다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import {
  spreadAbnormalFrom, barMissingOrLateFrom, medianSpread, foldMarket,
  type SpreadSample, type MarketMeasurement,
} from './measure-core.ts'

/** 기준선을 뽑을 때 훑는 봉 수. 1분 봉이면 두 시간 남짓이다 */
const BASELINE_BARS = 120

export interface MarketInput {
  contractCode: string
  /** 판단 봉 종류. 기준선과 마지막 봉을 같은 축에서 본다 */
  tf: string
  now: Date
  /** 지금 호가 */
  bestBid: number | null
  bestAsk: number | null
  /** 평소의 몇 배부터 이상인가 */
  spreadMultiple: number
  /** 마지막 봉이 몇 분 전이면 늦은 것인가 */
  lateMinutes: number
}

/**
 * 최근 봉들의 최우선 호가와 마지막 봉 시각을 한 번에 읽는다.
 *
 * 두 값이 같은 조회에서 나온다 — 따로 읽으면 그 사이에 봉이 하나 저장되어
 * 「기준선은 옛 봉, 마지막 봉은 새 봉」인 짝이 안 맞는 답이 나온다.
 */
export async function loadRecentBars(contractCode: string, tf: string, limit = BASELINE_BARS): Promise<{
  samples: SpreadSample[]
  lastBarStartAt: Date | null
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_bars')
    .select('bar_start_at, best_bid, best_ask')
    .eq('contract_code', contractCode)
    .eq('tf', tf)
    .order('bar_start_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`봉을 읽지 못했습니다: ${error.message}`)
  const rows = (data ?? []) as { bar_start_at: string; best_bid: number | null; best_ask: number | null }[]
  const first = rows[0]?.bar_start_at
  return {
    samples: rows.map((r) => ({
      // KIS 가 준 값이 그대로 들어와 있다. 숫자가 아니면 spreadOf 가 없는 것으로 친다
      bestBid: r.best_bid === null ? null : Number(r.best_bid),
      bestAsk: r.best_ask === null ? null : Number(r.best_ask),
    })),
    lastBarStartAt: first ? new Date(first) : null,
  }
}

/**
 * 둘을 잰다. **못 읽어도 던지지 않는다** —
 * 봉을 못 읽었다고 크론 전체가 죽으면 그 분에는 포지션 감시도 같이 죽는다.
 */
export async function measureMarket(input: MarketInput): Promise<MarketMeasurement> {
  let samples: SpreadSample[] = []
  let lastBarStartAt: Date | null = null
  let readFailed = false
  try {
    const loaded = await loadRecentBars(input.contractCode, input.tf)
    samples = loaded.samples
    lastBarStartAt = loaded.lastBarStartAt
  } catch {
    readFailed = true
  }

  const folded = foldMarket({
    spreadAbnormal: readFailed ? null : spreadAbnormalFrom({
      now: { bestBid: input.bestBid, bestAsk: input.bestAsk },
      baseline: medianSpread(samples),
      multiple: input.spreadMultiple,
    }),
    barMissingOrLate: readFailed ? null : barMissingOrLateFrom({
      lastBarStartAt, now: input.now, lateMinutes: input.lateMinutes,
    }),
  })
  return readFailed
    ? { ...folded, unmeasured: [...folded.unmeasured, 'barsUnreadable'] }
    : folded
}
