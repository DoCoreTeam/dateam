import 'server-only'

/**
 * 패턴 리포트 — 모으고 재고 적는 자리
 *
 * 셈은 `pattern-core.ts` 의 순수 함수가 한다. 여기는 표본을 읽어 오고 결과를 적는다.
 *
 * **리포트는 설정을 바꾸지 않는다.** 바꾸려면 스펙 후보(`proposal.ts`)를 지나고,
 * 그것도 사람이 받아들여야 적용된다(§15.2 · §15.3).
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callKnowledge } from './ai-call.ts'
import { applyAsOf } from './as-of.ts'
import {
  computePatterns, isPatternRejection, metricsToLines, buildPatternPrompt,
  type PatternSample, type PatternMetrics,
} from './pattern-core.ts'

export interface StoredReport {
  id: string
  windowFrom: string
  windowTo: string
  sampleCount: number
  metrics: PatternMetrics
  narrative: string | null
  availableAt: Date
}

/** 그 시각에 볼 수 있던 리포트만 */
export async function reportsAsOf(asOf: Date, limit = 12): Promise<StoredReport[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_pattern_reports')
      .select('id, window_from, window_to, sample_count, metrics, narrative, available_at')
      .order('window_to', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`패턴 리포트를 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    windowFrom: String(r.window_from),
    windowTo: String(r.window_to),
    sampleCount: Number(r.sample_count),
    metrics: r.metrics as PatternMetrics,
    narrative: (r.narrative as string | null) ?? null,
    availableAt: new Date(r.available_at),
  }))
}

/**
 * 결과가 정해진 신호만 표본으로 읽는다.
 *
 * 진행 중인 신호를 넣으면 「아직 안 끝난 일」이 승률에 0으로 들어간다.
 */
export async function loadSamples(from: string, to: string): Promise<PatternSample[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('bar_close_at, direction, result, risk_per_trade_krw, reference_price, target_price, judgment_id')
    .gte('bar_close_at', `${from}T00:00:00+09:00`)
    .lte('bar_close_at', `${to}T23:59:59+09:00`)
    .not('result', 'is', null)
  if (error) throw new Error(`표본을 읽지 못했습니다: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).flatMap((row) => {
    const result = String(row.result)
    // 건너뛴 신호는 성과가 없다. 「0R」 로 세면 안 한 일이 진 일로 기록된다
    if (result === 'skipped' || result === 'expired') return []
    const at = new Date(row.bar_close_at)
    return [{
      tradeDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at),
      minutesSinceOpen: minutesSinceSeoulOpen(at),
      direction: row.direction === 'short' ? ('short' as const) : ('long' as const),
      triggerId: String(row.judgment_id ?? 'unknown').slice(0, 8),
      // 1-C 는 체결 연결이 없어 실제 손익이 아직 없다. 없으면 표본이 아니다
      netPnlR: 0,
    }]
  })
}

/** 서울 09:00 기준 경과 분. 정규장 개장이다 */
function minutesSinceSeoulOpen(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return Math.max(0, h * 60 + m - 9 * 60)
}

export type MakeReportResult =
  | { made: true; id: string; sampleCount: number }
  | { made: false; reason: string; userMessage: string }

export interface MakeReportInput {
  from: string
  to: string
  minSamples: number
  minBucketSamples: number
  model?: string | null
}

export async function makeReport(input: MakeReportInput): Promise<MakeReportResult> {
  const samples = await loadSamples(input.from, input.to)
  const metrics = computePatterns({
    samples,
    minSamples: input.minSamples,
    minBucketSamples: input.minBucketSamples,
  })
  if (isPatternRejection(metrics)) {
    return { made: false, ...metrics }
  }

  /**
   * 말은 **나중에** 붙인다. AI 가 죽어도 숫자는 남아야 한다 —
   * 숫자가 리포트의 본체이고 문장은 읽기 편하라고 붙이는 것이다.
   */
  const call = await callKnowledge({
    purpose: 'pattern_report',
    prompt: buildPatternPrompt(metricsToLines(metrics)),
    model: input.model,
    json: false,
    maxOutputTokens: 2048,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_pattern_reports').insert({
    window_from: metrics.windowFrom,
    window_to: metrics.windowTo,
    sample_count: metrics.sampleCount,
    metrics,
    narrative: call.ok ? call.text : null,
    model: call.ok ? call.model : null,
  }).select('id')

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { made: false, reason: 'already_made', userMessage: '이 구간 리포트는 이미 있습니다' }
    }
    return { made: false, reason: `save_failed:${error.message}`.slice(0, 300), userMessage: '리포트를 저장하지 못했습니다' }
  }
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return { made: false, reason: 'no_id_returned', userMessage: '리포트를 저장하지 못했습니다' }
  return { made: true, id, sampleCount: metrics.sampleCount }
}
