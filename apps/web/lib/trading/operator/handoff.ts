import 'server-only'

/**
 * 사람에게 넘기기 — **기존 업무로 간다** (명세 §16)
 *
 * ## 왜 새 할 일 표를 안 만드나
 *
 * 표를 하나 더 만들면 사람이 볼 곳이 하나 더 는다. 그러면 둘 중 하나는 안 보게 되고,
 * 안 보는 쪽이 대개 새로 만든 쪽이다 — 기존 업무 화면은 이미 매일 열지만
 * 「트레이딩 운영자 할 일」 화면은 무슨 일이 있어야 연다.
 *
 * 그래서 `daily_logs` 에 넣는다. 일일업무 화면에 그날 할 일로 뜬다.
 *
 * ## 무엇을·왜·무엇이 있으면 되는지
 *
 * 셋이 없으면 받은 사람이 다시 물어야 한다. 「증권사 조회 실패」만 적혀 있으면
 * 무엇을 해야 하는지 모른다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { recordAction } from './remedy.ts'
import { actionLabel } from './remedy.ts'
import { handoffContent, priorityOf } from './handoff-content.ts'
import type { CheckResult } from './checks.ts'
import type { ActionId } from './remedy-policy.ts'

export { handoffContent, WHAT_IS_NEEDED } from './handoff-content.ts'

export type HandoffResult =
  | { handed: true; logId: string }
  /** 이미 넘겼거나 못 넘겼다. **점검 기록은 그대로다** */
  | { handed: false; reason: string }

export interface HandoffInput {
  tradeDate: string
  ownerUserId: string
  check: CheckResult
  actionId: ActionId
  why: string
}

/**
 * 일일업무로 넘긴다.
 *
 * 같은 날 같은 점검은 한 번만 — 조치 표의 부분 유일 인덱스가 막는다.
 * 날마다 같은 할 일이 쌓이면 사람은 그 줄을 안 읽게 된다.
 */
export async function handOff(input: HandoffInput): Promise<HandoffResult> {
  // 먼저 「넘겼다」를 기록해 본다. 유일 인덱스에 걸리면 이미 넘긴 것이다
  const claimed = await recordAction({
    tradeDate: input.tradeDate,
    checkId: input.check.id,
    actionId: input.actionId,
    actorKind: 'ai',
    actorUserId: null,
    outcome: 'handed_off',
    reason: input.why,
  })
  if (!claimed.saved) return { handed: false, reason: claimed.reason ?? 'not_saved' }

  try {
    const logId = await insertDailyLog(input)
    await linkHandoff(input, logId)
    return { handed: true, logId }
  } catch (error) {
    /**
     * 업무를 못 넣었다. **점검 기록과 조치 기록은 그대로 남는다** —
     * 넘겼다는 기록만 있고 업무가 없으면 화면에서 그 사실이 보인다.
     */
    return {
      handed: false,
      reason: `daily_log_failed:${error instanceof Error ? error.message : 'unknown'}`.slice(0, 200),
    }
  }
}

async function insertDailyLog(input: HandoffInput): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('daily_logs').insert({
    user_id: input.ownerUserId,
    log_date: input.tradeDate,
    content: handoffContent(input.check),
    // 할 일이다. 한 일이 아니다
    entry_type: 'planned',
    // AI 가 뽑아낸 것임을 남긴다. 사람이 쓴 것과 섞이면 안 된다
    source_type: 'ai_derived',
    priority: priorityOf(input.check.status),
    is_resolved: false,
    ai_processed: true,
  }).select('id')
  if (error) throw new Error(error.message)
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) throw new Error('no_id_returned')
  return id
}

/** 어느 업무로 갔는지를 조치 기록에 이어 둔다 */
async function linkHandoff(input: HandoffInput, logId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_operator_actions')
    .update({ handoff_log_id: logId })
    .eq('trade_date', input.tradeDate)
    .eq('check_id', input.check.id)
    .eq('action_id', input.actionId)
    .eq('outcome', 'handed_off')
  if (error) throw new Error(error.message)
}

export { actionLabel }
