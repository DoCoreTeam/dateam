import 'server-only'

/**
 * 스펙 후보 — 올리고 사람이 받아들이는 자리 (§15.2 · §15.3)
 *
 * **이 모듈은 설정을 안 쓴다.** 후보를 표에 올릴 뿐이고, 받아들이는 자리(`acceptProposal`)
 * 에서만 `saveTradingSetting` 을 부르며 그때 **사람의 ID 가 반드시 있다.**
 * AI 가 부를 수 있는 함수(`proposeFromReport`)에서 설정으로 가는 길은 없다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { saveTradingSetting, loadTradingSettings } from '../settings/store.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'
import { callKnowledge } from './ai-call.ts'
import { applyAsOf } from './as-of.ts'
import {
  aiMayPropose, validateProposal, parseProposals, buildProposalPrompt,
  applyTiming, effectiveDateFor,
  type Proposal,
} from './proposal-policy.ts'

export interface StoredProposal {
  id: string
  settingKey: string
  currentValue: unknown
  proposedValue: unknown
  rationale: string
  evidence: { kind: string; ref: string; note: string }[]
  status: string
  effectiveTradeDate: string | null
  availableAt: Date
}

/** 그 시각에 볼 수 있던 후보만 */
export async function proposalsAsOf(asOf: Date, limit = 30): Promise<StoredProposal[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_spec_candidates')
      .select('id, setting_key, current_value, proposed_value, rationale, evidence, status, effective_trade_date, available_at')
      .order('available_at', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`스펙 후보를 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    settingKey: String(r.setting_key),
    currentValue: r.current_value,
    proposedValue: r.proposed_value,
    rationale: String(r.rationale),
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
    status: String(r.status),
    effectiveTradeDate: (r.effective_trade_date as string | null) ?? null,
    availableAt: new Date(r.available_at),
  }))
}

/** AI 가 건드려도 되는 설정만 골라 프롬프트에 넣는다 */
export async function allowedSettings(tradeDate: string) {
  const { values } = await loadTradingSettings(tradeDate)
  return TRADING_SETTINGS
    .filter((s) => aiMayPropose(s.key) === null)
    // 문자열·불리언 설정은 제안 대상에서 뺀다. 숫자만 성과표로 근거를 댈 수 있다
    .filter((s) => s.type === 'number')
    .map((s) => ({
      key: s.key,
      label: s.label,
      current: values[s.key],
      min: s.min,
      max: s.max,
    }))
}

export interface ProposeResult {
  proposed: number
  rejected: { settingKey: string; reason: string }[]
  /** AI 가 답을 못 냈으면 그 사유 */
  callReason: string | null
}

/**
 * 성과표를 보고 후보를 낸다. **설정을 안 바꾼다.**
 */
export async function proposeFromReport(input: {
  tradeDate: string
  reportLines: readonly string[]
  model?: string | null
}): Promise<ProposeResult> {
  const allowed = await allowedSettings(input.tradeDate)
  const call = await callKnowledge({
    purpose: 'spec_candidate',
    prompt: buildProposalPrompt(allowed, input.reportLines),
    model: input.model,
    json: true,
    maxOutputTokens: 4096,
  })
  if (!call.ok) return { proposed: 0, rejected: [], callReason: call.reason }

  let raw: unknown
  try {
    raw = JSON.parse(call.text)
  } catch {
    return { proposed: 0, rejected: [], callReason: 'bad_json' }
  }

  const allowedKeys = new Set(allowed.map((a) => a.key))
  const rejected: { settingKey: string; reason: string }[] = []
  let proposed = 0

  for (const p of parseProposals(raw)) {
    // 목록에 없는 키는 여기서 끝난다. 프롬프트에 적은 것만으로는 안 막힌다
    if (!allowedKeys.has(p.settingKey)) {
      rejected.push({ settingKey: p.settingKey, reason: 'not_allowed' })
      continue
    }
    const current = allowed.find((a) => a.key === p.settingKey)?.current ?? null
    const withCurrent: Proposal = { ...p, currentValue: current }
    const rejection = validateProposal(withCurrent)
    if (rejection) {
      rejected.push({ settingKey: p.settingKey, reason: rejection.reason })
      continue
    }
    const saved = await saveProposal(withCurrent, input.tradeDate, call.model)
    if (saved) proposed += 1
    else rejected.push({ settingKey: p.settingKey, reason: 'already_open' })
  }
  return { proposed, rejected, callReason: null }
}

async function saveProposal(p: Proposal, today: string, model: string): Promise<boolean> {
  const timing = applyTiming(p.settingKey, p.currentValue, p.proposedValue)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_spec_candidates').insert({
    setting_key: p.settingKey,
    current_value: p.currentValue,
    proposed_value: p.proposedValue,
    rationale: p.rationale,
    evidence: p.evidence,
    effective_trade_date: effectiveDateFor(timing, today),
    model,
  })
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return false
    throw new Error(`후보를 올리지 못했습니다: ${error.message}`)
  }
  return true
}

export type DecideResult =
  | { ok: true; applied: boolean; effectiveTradeDate: string | null }
  | { ok: false; reason: string; userMessage: string }

/**
 * 사람이 후보를 받아들이거나 물린다.
 *
 * **`actorUserId` 가 필수다.** 없으면 아무 일도 안 한다 — 이 함수에 사람이 없으면
 * AI 가 자기 제안을 스스로 받아들이는 길이 생긴다(§15.3).
 */
export async function decideProposal(input: {
  proposalId: string
  accept: boolean
  actorUserId: string
  note?: string
}): Promise<DecideResult> {
  if (!input.actorUserId) {
    return { ok: false, reason: 'no_actor', userMessage: '사람만 후보를 결정할 수 있습니다' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_spec_candidates')
    .select('id, setting_key, proposed_value, status, effective_trade_date')
    .eq('id', input.proposalId)
    .limit(1)
  if (error) throw new Error(`후보를 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (data ?? [])[0] as any
  if (!row) return { ok: false, reason: 'not_found', userMessage: '후보를 찾을 수 없습니다' }
  if (row.status !== 'proposed') {
    return { ok: false, reason: `already_${row.status}`, userMessage: '이미 결정된 후보입니다' }
  }

  // 받아들일 때 한 번 더 막는다. 표에 들어온 뒤 금지 목록이 늘어났을 수 있다
  const forbidden = aiMayPropose(String(row.setting_key))
  if (forbidden) return { ok: false, ...forbidden }

  if (input.accept) {
    const saved = await saveTradingSetting({
      key: String(row.setting_key),
      value: row.proposed_value,
      source: 'ai',
      changedBy: input.actorUserId,
      effectiveTradeDate: String(row.effective_trade_date),
      reason: `스펙 후보 승인 · ${input.note ?? ''}`.trim(),
    })
    if (!saved.ok) return { ok: false, reason: saved.rejection.reason, userMessage: saved.rejection.userMessage }
  }

  const { error: updateError } = await admin.from('trading_spec_candidates').update({
    status: input.accept ? 'accepted' : 'rejected',
    decided_by: input.actorUserId,
    decided_at: new Date().toISOString(),
    decision_note: input.note ?? null,
  }).eq('id', input.proposalId)
  if (updateError) throw new Error(`결정을 적지 못했습니다: ${updateError.message}`)

  return {
    ok: true,
    applied: input.accept,
    effectiveTradeDate: input.accept ? String(row.effective_trade_date) : null,
  }
}
