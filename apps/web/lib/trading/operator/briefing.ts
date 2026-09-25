import 'server-only'

/**
 * 브리핑 — 모아서 세고 적는 자리
 *
 * 셈은 `briefing-core.ts` 가 한다. **AI 가 죽어도 숫자는 남는다** —
 * 숫자가 브리핑의 본체이고 문장은 읽기 편하라고 붙이는 것이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callKnowledge } from '../knowledge/ai-call.ts'
import { applyAsOf } from '../knowledge/as-of.ts'
import {
  computeBriefing, briefingLines, buildBriefingPrompt,
  type BriefingInput, type BriefingMetrics,
} from './briefing-core.ts'

export interface StoredBriefing {
  tradeDate: string
  metrics: BriefingMetrics
  narrative: string | null
  availableAt: Date
}

/** 그 시각에 볼 수 있던 브리핑만 */
export async function briefingsAsOf(asOf: Date, limit = 14): Promise<StoredBriefing[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_briefings')
      .select('trade_date, metrics, narrative, available_at')
      .order('trade_date', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`브리핑을 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    tradeDate: String(r.trade_date),
    metrics: r.metrics as BriefingMetrics,
    narrative: (r.narrative as string | null) ?? null,
    availableAt: new Date(r.available_at),
  }))
}

export type MakeBriefingResult =
  | { made: true; tradeDate: string }
  | { made: false; reason: string; userMessage: string }

export async function makeBriefing(
  input: BriefingInput, model?: string | null,
): Promise<MakeBriefingResult> {
  const metrics = computeBriefing(input)

  /**
   * 말은 나중에 붙인다. 호출이 실패해도 **숫자는 저장한다** —
   * 실패로 브리핑을 통째로 버리면 그날 기록이 사라진다.
   */
  const call = await callKnowledge({
    purpose: 'pattern_report',
    prompt: buildBriefingPrompt(briefingLines(metrics)),
    model,
    json: false,
    maxOutputTokens: 1024,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_briefings').insert({
    trade_date: input.tradeDate,
    metrics,
    narrative: call.ok ? call.text : null,
    model: call.ok ? call.model : null,
  })
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { made: false, reason: 'already_made', userMessage: '오늘 브리핑은 이미 있습니다' }
    }
    return {
      made: false,
      reason: `save_failed:${error.message}`.slice(0, 300),
      userMessage: '브리핑을 저장하지 못했습니다',
    }
  }
  return { made: true, tradeDate: input.tradeDate }
}
