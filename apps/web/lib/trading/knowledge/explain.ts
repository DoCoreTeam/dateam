import 'server-only'

/**
 * 신호 설명 — **알림이 나간 뒤에** 붙인다 (§12)
 *
 * 알림 발송 경로(`notify/outbox.ts`, `jobs/emit-signal.ts`)는 이 모듈을 안 부른다.
 * 가드가 그 사실을 센다 — 부르면 AI 가 죽은 날 알림이 통째로 안 나간다.
 *
 * 설명은 신호를 **안 바꾼다.** 쓰는 곳은 설명 표 하나뿐이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callKnowledge } from './ai-call.ts'
import { applyAsOf } from './as-of.ts'
import {
  buildExplainPrompt, checkExplanation, checkFactKeys, normalizeExplanation, type SignalFacts,
} from './explain-policy.ts'

export interface StoredExplanation {
  signalId: string
  body: string
  availableAt: Date
}

/** 그 시각에 볼 수 있던 설명만 */
export async function explanationsAsOf(asOf: Date, limit = 20): Promise<StoredExplanation[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_signal_explanations')
      .select('signal_id, body, available_at')
      .order('available_at', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`신호 설명을 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    signalId: String(r.signal_id),
    body: String(r.body),
    availableAt: new Date(r.available_at),
  }))
}

/** 아직 설명 없는 신호를 오래된 순으로 */
export async function signalsNeedingExplanation(limit = 5): Promise<{ id: string; facts: SignalFacts }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('id, direction, reference_price, stop_price, target_price, calibrated_prob,'
      + ' net_expected_value_r, risk_per_trade_krw, judgment_id, bar_close_at,'
      + ' trading_signal_explanations(signal_id)')
    .order('bar_close_at', { ascending: false })
    .limit(limit * 4)
  if (error) throw new Error(`신호를 읽지 못했습니다: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((r) => !Array.isArray(r.trading_signal_explanations) || r.trading_signal_explanations.length === 0)
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      facts: {
        direction: r.direction === 'short' ? ('short' as const) : ('long' as const),
        referencePrice: Number(r.reference_price),
        stopPrice: Number(r.stop_price),
        targetPrice: Number(r.target_price),
        calibratedProb: r.calibrated_prob === null ? null : Number(r.calibrated_prob),
        netExpectedValueR: r.net_expected_value_r === null ? null : Number(r.net_expected_value_r),
        riskPerTradeKrw: Number(r.risk_per_trade_krw),
        triggerId: (r.judgment_id as string | null)?.slice(0, 8) ?? null,
        minutesSinceOpen: minutesSinceSeoulOpen(new Date(r.bar_close_at)),
      },
    }))
}

function minutesSinceSeoulOpen(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return Math.max(0, h * 60 + m - 9 * 60)
}

export type ExplainResult =
  | { explained: true }
  | { explained: false; reason: string; userMessage: string }

/**
 * 신호 하나를 설명한다.
 *
 * 실패해도 신호와 알림은 그대로다 — 이 함수는 신호 표를 안 만진다.
 */
export async function explainSignal(
  signalId: string, facts: SignalFacts, promptVersion: string, model?: string | null,
): Promise<ExplainResult> {
  // 목록 밖의 값이 섞였으면 프롬프트를 아예 안 만든다
  const extra = checkFactKeys(facts as unknown as Record<string, unknown>)
  if (extra) return { explained: false, ...extra }

  const call = await callKnowledge({
    purpose: 'signal_explain',
    prompt: buildExplainPrompt(facts),
    model,
    json: false,
    maxOutputTokens: 1024,
  })
  if (!call.ok) return { explained: false, reason: call.reason, userMessage: call.userMessage }

  const body = normalizeExplanation(call.text)
  const bad = checkExplanation(body)
  if (bad) return { explained: false, ...bad }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_signal_explanations').insert({
    signal_id: signalId,
    body,
    model: call.model,
    prompt_version: promptVersion,
  })
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { explained: false, reason: 'already_explained', userMessage: '이미 설명한 신호입니다' }
    }
    return { explained: false, reason: `save_failed:${error.message}`.slice(0, 300), userMessage: '설명을 저장하지 못했습니다' }
  }
  return { explained: true }
}
