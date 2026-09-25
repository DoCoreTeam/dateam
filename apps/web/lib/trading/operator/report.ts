import 'server-only'

/**
 * 기간 리포트 — 모아 세고 적는 자리
 *
 * 셈은 `report-core.ts` 가 한다. 쓰는 표는 `trading_reports` 하나뿐이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callKnowledge } from '../knowledge/ai-call.ts'
import { applyAsOf } from '../knowledge/as-of.ts'
import {
  computeReport, isReportRejection, reportLines, buildReportPrompt,
  type ReportInput, type ReportMetrics,
} from './report-core.ts'

export interface StoredReport {
  id: string
  from: string
  to: string
  metrics: ReportMetrics
  narrative: string | null
  availableAt: Date
}

export async function reportsAsOf(asOf: Date, limit = 12): Promise<StoredReport[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_reports')
      .select('id, period_from, period_to, metrics, narrative, available_at')
      .order('period_to', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`리포트를 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    from: String(r.period_from),
    to: String(r.period_to),
    metrics: r.metrics as ReportMetrics,
    narrative: (r.narrative as string | null) ?? null,
    availableAt: new Date(r.available_at),
  }))
}

export type MakeReportResult =
  | { made: true; id: string }
  | { made: false; reason: string; userMessage: string }

export async function makeReport(
  input: ReportInput, model?: string | null,
): Promise<MakeReportResult> {
  const metrics = computeReport(input)
  if (isReportRejection(metrics)) return { made: false, ...metrics }

  // 말은 나중에. 실패해도 숫자는 저장한다
  const call = await callKnowledge({
    purpose: 'pattern_report',
    prompt: buildReportPrompt(reportLines(metrics)),
    model,
    json: false,
    maxOutputTokens: 2048,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_reports').insert({
    period_from: input.from,
    period_to: input.to,
    metrics,
    narrative: call.ok ? call.text : null,
    model: call.ok ? call.model : null,
  }).select('id')

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { made: false, reason: 'already_made', userMessage: '이 기간 리포트는 이미 있습니다' }
    }
    return {
      made: false,
      reason: `save_failed:${error.message}`.slice(0, 300),
      userMessage: '리포트를 저장하지 못했습니다',
    }
  }
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return { made: false, reason: 'no_id_returned', userMessage: '리포트를 저장하지 못했습니다' }
  return { made: true, id }
}
