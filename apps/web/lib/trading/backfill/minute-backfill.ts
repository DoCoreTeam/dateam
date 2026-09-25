import 'server-only'

/**
 * 과거 분봉 백필 — **그때 알았던 것처럼 만들지 않는다**
 *
 * ## `available_at` 이 왜 받은 시각인가 (M5)
 *
 * 2026년 3월 봉을 오늘 받았다면, 우리가 그 값을 **알게 된 것은 오늘**이다.
 * `available_at` 을 봉 시각으로 적으면 백테스트가 「그때 이미 알고 있었다」고 읽고,
 * 그 성적은 실시간에 재현되지 않는다. 과거를 받되 **언제 받았는지는 속이지 않는다.**
 *
 * ## 실시간 수집을 방해하지 않는다
 *
 * 같은 순차 큐를 지나므로 백필이 도는 동안에도 호출 간격은 지켜진다.
 * 실패가 이어지면 멈춘다 — 막힌 상태로 수백 번을 더 물으면 실시간 수집까지 같이 죽는다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { createKisClient, type KisClient } from '../broker/kis-client.ts'
import { saveBars } from '../bars/store.ts'
import {
  missingRanges, chunkRange, shouldContinue,
  type BackfillProgress, type BackfillWindow,
} from './plan.ts'

export interface BackfillInput {
  contractCode: string
  /** 포함 */
  from: Date
  /** 제외 */
  to: Date
  kis: KisClient
  /** 이어지는 실패가 이만큼이면 멈춘다 */
  maxFailures?: number
  /** 지금 시각. `available_at` 에 들어간다 */
  now?: Date
}

export interface BackfillResult extends BackfillProgress {
  ok: boolean
  reason: string
  userMessage: string | null
}

/** 이미 가진 봉의 시작 시각들 */
async function heldStartAt(contractCode: string, window: BackfillWindow): Promise<number[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_bars')
    .select('bar_start_at')
    .eq('contract_code', contractCode)
    .eq('tf', '1m')
    .gte('bar_start_at', new Date(window.fromMs).toISOString())
    .lt('bar_start_at', new Date(window.toMs).toISOString())
  if (error) throw new Error(`가진 봉을 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as { bar_start_at: string }[]).map((r) => Date.parse(r.bar_start_at))
}

export async function backfillMinuteBars(input: BackfillInput): Promise<BackfillResult> {
  const now = input.now ?? new Date()
  const window: BackfillWindow = { fromMs: input.from.getTime(), toMs: input.to.getTime() }
  const maxFailures = input.maxFailures ?? 3

  const held = { startAtMs: await heldStartAt(input.contractCode, window) }
  const gaps = missingRanges(window, held)
  const chunks = gaps.flatMap(chunkRange)

  const progress: BackfillProgress = {
    planned: chunks.length, filled: 0, emptyChunks: 0, failed: 0, barsSaved: 0,
  }

  for (const chunk of chunks) {
    if (!shouldContinue(progress, maxFailures)) {
      return {
        ...progress,
        ok: false,
        reason: `stopped_after_failures:${progress.failed}`,
        userMessage: '증권사 조회가 이어서 실패해 백필을 멈췄습니다',
      }
    }

    const fetched = await input.kis.minuteBars({
      contractCode: input.contractCode,
      from: new Date(chunk.fromMs),
      until: new Date(chunk.untilMs),
    })
    if (!fetched.ok) { progress.failed += 1; continue }

    const bars = fetched.value.bars.filter((b) =>
      b.startAt.getTime() >= chunk.fromMs && b.startAt.getTime() < chunk.untilMs)
    if (bars.length === 0) { progress.emptyChunks += 1; continue }

    await saveBars({
      contractCode: input.contractCode,
      tf: '1m',
      bars,
      // 확정은 그때 났지만 **우리가 안 것은 지금**이다. 둘을 같게 적으면 백테스트가 미래를 본다
      confirmedAt: now,
      source: 'kis',
    })
    progress.filled += 1
    progress.barsSaved += bars.length
  }

  return {
    ...progress,
    ok: true,
    reason: `backfilled:planned=${progress.planned},filled=${progress.filled},empty=${progress.emptyChunks},bars=${progress.barsSaved}`,
    userMessage: null,
  }
}

export { createKisClient }
