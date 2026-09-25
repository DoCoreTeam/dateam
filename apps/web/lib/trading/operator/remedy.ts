import 'server-only'

/**
 * 조치를 실제로 하고 기록하는 자리
 *
 * 판정은 `remedy-policy.ts` 가 한다. 여기는 그 판정대로 하고 **무엇을 했는지 남긴다.**
 *
 * 조치 기록은 append-only 다. 「AI 가 무엇을 했나」에 답할 것이 있어야
 * 맡길 범위를 넓힐 수 있다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { flushNotifications } from '../notify/outbox.ts'
import { analyzeSource, nextPendingSourceId } from '../knowledge/sources.ts'
import {
  whoDoes, ACTION_LABEL, type ActionId, type Remedy, type RemedyDecision,
} from './remedy-policy.ts'

export type ActorKind = 'ai' | 'human'
export type ActionOutcome = 'applied' | 'handed_off' | 'refused' | 'failed'

export interface RemedyRecord {
  tradeDate: string
  checkId: string
  actionId: ActionId
  actorKind: ActorKind
  actorUserId: string | null
  outcome: ActionOutcome
  reason: string
  handoffLogId?: string | null
}

/** 조치 기록을 남긴다. **덮어쓰지 않는다** */
export async function recordAction(record: RemedyRecord): Promise<{ saved: boolean; reason?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_operator_actions').insert({
    trade_date: record.tradeDate,
    check_id: record.checkId,
    action_id: record.actionId,
    actor_kind: record.actorKind,
    actor_user_id: record.actorUserId,
    outcome: record.outcome,
    reason: record.reason.slice(0, 500),
    handoff_log_id: record.handoffLogId ?? null,
  })
  if (error) {
    // 같은 날 같은 인계가 두 번 = 이미 넘겼다. 오류가 아니다
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { saved: false, reason: 'already_recorded' }
    }
    throw new Error(`조치를 적지 못했습니다: ${error.message}`)
  }
  return { saved: true }
}

export interface ApplyInput {
  tradeDate: string
  decision: RemedyDecision
  now: Date
  model?: string | null
}

export type ApplyResult =
  | { outcome: 'applied'; detail: string }
  | { outcome: 'refused'; detail: string }
  | { outcome: 'failed'; detail: string }
  /** 사람 몫이다. 인계는 `handoff.ts` 가 한다 */
  | { outcome: 'needs_human'; why: string }

/**
 * AI 가 조치를 한다.
 *
 * **여기서 한 번 더 묻는다.** 판정을 이미 했어도 다시 묻는 이유는, 판정과 실행 사이에
 * 허용 목록이 줄어들었을 수 있고 그 사이의 조치는 검토를 안 거친 것이기 때문이다.
 */
export async function applyRemedy(input: ApplyInput): Promise<ApplyResult> {
  const { remedy } = input.decision
  if (input.decision.by === 'human') {
    return { outcome: 'needs_human', why: input.decision.why }
  }

  const who = whoDoes(remedy.actionId)
  if (who.by !== 'ai') {
    await recordAction({
      tradeDate: input.tradeDate, checkId: remedy.checkId, actionId: remedy.actionId,
      actorKind: 'ai', actorUserId: null, outcome: 'refused', reason: who.why,
    })
    return { outcome: 'refused', detail: who.why }
  }

  try {
    const detail = await runAction(remedy, input)
    await recordAction({
      tradeDate: input.tradeDate, checkId: remedy.checkId, actionId: remedy.actionId,
      actorKind: 'ai', actorUserId: null, outcome: 'applied', reason: detail,
    })
    return { outcome: 'applied', detail }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown'
    await recordAction({
      tradeDate: input.tradeDate, checkId: remedy.checkId, actionId: remedy.actionId,
      actorKind: 'ai', actorUserId: null, outcome: 'failed', reason: detail,
    })
    return { outcome: 'failed', detail }
  }
}

/**
 * 실제로 하는 일. **셋뿐이고 전부 되돌릴 수 있다.**
 *
 * 되돌릴 수 있다는 것의 뜻: 다시 해도 같은 결과이고, 잘못해도 원래 상태로 돌아간다.
 *   · 알림 재발송 — 아웃박스 유일 키가 두 번 안 보낸다
 *   · 봉 백필 — 같은 봉은 유일 키가 하나로 만든다
 *   · 자료 재분석 — 원문은 그대로고 분석만 다시 쓴다
 */
async function runAction(remedy: Remedy, input: ApplyInput): Promise<string> {
  if (remedy.actionId === 'retry_notifications') {
    const r = await flushNotifications(input.now)
    return `sent=${r.sent},failed=${r.failed}`
  }
  if (remedy.actionId === 'reanalyze_source') {
    const id = await nextPendingSourceId()
    if (!id) return 'none'
    const r = await analyzeSource(id, input.model)
    return r.analyzed ? `kept=${r.kept}` : r.reason
  }
  if (remedy.actionId === 'backfill_bars') {
    /**
     * 봉 백필은 이 자리에서 안 한다.
     *
     * 되돌릴 수 있는 일이지만 KIS 를 여러 번 부르고 1분 실행 안에서 끝나지 않는다.
     * 크론의 수집 경로가 이미 같은 일을 하고, 두 곳이 같은 봉을 받으면 한도만 쓴다.
     * 그래서 「다음 수집이 채운다」를 기록하고 넘어간다 — 조용히 안 넘어간다.
     */
    return 'deferred_to_collector'
  }
  throw new Error(`unknown_action:${remedy.actionId}`)
}

/** 화면이 읽을 이름 */
export function actionLabel(actionId: ActionId): string {
  return ACTION_LABEL[actionId]
}
