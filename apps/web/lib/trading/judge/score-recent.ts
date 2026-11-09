import 'server-only'

/**
 * 최근 판단을 채점한다 — **현황의 성적 칸과 신호 관문이 같은 결과를 읽는다**
 *
 * 전에는 이 셈이 현황 화면 안에만 있었다. 관문이 따로 세면 화면은 「미달」인데
 * 신호는 나가는 날이 생긴다. 채점은 `score.ts`(그 안은 백테스트의 `replayExecution`) 그대로다.
 *
 * 그날의 근월물 판단만 센다. 다른 월물의 판단을 이 월물 봉으로 채점하면 가격이 다른 두 상품을 섞는다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { loadBarsAsOf } from '../bars/store.ts'
import { loadInstrumentSpec } from '../settings/store.ts'
import { leaningOf } from '../judgment-labels.ts'
import { scoreJudgment, type JudgmentScore } from './score.ts'

/**
 * 채점에 쓸 봉 수 — **차트보다 넉넉히 읽는다.**
 *
 * 판단이 난 뒤 결판이 날 때까지의 봉이 있어야 채점이 되고, 앞으로는 지표를 구할 만큼
 * 더 필요하다. 차트용 180봉으로 재면 오래된 판단이 죄다 「아직」으로 잡힌다.
 */
const SCORE_BARS = 3_000
const SCORE_JUDGMENTS = 2_000

export type RecentScores =
  | { ok: true; scores: JudgmentScore[]; multiplier: number }
  | { ok: false; reason: string }

export async function scoreRecentJudgments(input: {
  contractCode: string
  now: Date
  today: string
  values: Readonly<Record<string, unknown>>
  /** 그날 접속매매 끝 몇 분 전에 파는가 */
  exitBefore: number
}): Promise<RecentScores> {
  const { contractCode, now, today, values, exitBefore } = input
  const feePercent = Number(values.fee_percent_per_side) || 0
  const feeFlat = Number(values.fee_rate) || 0
  // 승수와 호가 간격은 표가 유일한 출처다(M6). 못 읽으면 못 잰 것이고 기본값을 안 끼운다
  const instrument = await loadInstrumentSpec(today)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const bars = await loadBarsAsOf({ contractCode, tf: '1m', asOf: now, limit: SCORE_BARS })
  if (bars.length === 0) return { ok: false, reason: '가격 봉이 아직 없습니다' }

  const { data, error } = await admin
    .from('trading_judgments')
    .select('id, bar_close_at, judge, raw_score')
    .eq('status', 'completed')
    .eq('contract_code', contractCode)
    .not('raw_score', 'is', null)
    .order('bar_close_at', { ascending: false })
    .limit(SCORE_JUDGMENTS)
  if (error) return { ok: false, reason: `판단을 읽지 못했습니다: ${error.message}` }

  const slippage = instrument.tickSize * 2
  const scores: JudgmentScore[] = []
  for (const row of (data ?? []) as { id: string; bar_close_at: string; judge: string; raw_score: Record<string, number> }[]) {
    const lean = leaningOf(row.raw_score)
    // 관망은 채점하지 않는다 — 들어갈 자리가 없으므로 맞고 틀림이 없다
    if (!lean || lean.direction === 'hold') continue
    scores.push(scoreJudgment(
      { id: row.id, barCloseAt: row.bar_close_at, judge: row.judge, direction: lean.direction },
      bars,
      {
        indicators: {
          atrPeriod: Number(values.atr_period) || 14,
          smaFastPeriod: Number(values.sma_fast_period) || 5,
          smaSlowPeriod: Number(values.sma_slow_period) || 20,
          breakoutPeriod: Number(values.breakout_period) || 20,
        },
        exit: {
          stopAtrMultiple: Number(values.exit_stop_atr_multiple) || 1.2,
          targetAtrMultiple: Number(values.exit_target_atr_multiple) || 1.5,
          chaseAtrMultiple: Number(values.exit_chase_atr_multiple) || 0.3,
          timeExitMinutes: Number(values.min_hold_minutes) || 15,
        },
        instrument,
        quantity: 1,
        delayMinutes: Number(values.replay_delay_minutes) || 2,
        orderKind: String(values.replay_order_type ?? 'market') === 'limit' ? 'limit' : 'market',
        slippagePoints: slippage,
        stopSlippagePoints: slippage,
        feePercentPerSide: feePercent,
        feeFlatKrw: feeFlat,
        // 실시간과 같은 규칙으로 판다 — 그날 접속매매 끝 N분 전
        sessionCloseAt: (barStartAt) => {
          const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(barStartAt)
          return new Date(new Date(`${day}T15:45:00+09:00`).getTime() - exitBefore * 60_000)
        },
      },
    ))
  }
  return { ok: true, scores, multiplier: instrument.multiplier }
}
