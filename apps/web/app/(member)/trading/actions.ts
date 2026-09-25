'use server'

// app/(member)/trading/actions.ts — 신호 확인 창구
//
// **왜 창구가 하나인가**: 단추 셋이 값을 바꾼다. 화면 안에서 직접 쓰면 소유자 확인이
// 화면마다 흩어지고, 새 화면을 만든 사람이 기억해야 한다. 기억해야 하는 규칙은 빠뜨린다.
//
// **왜 새 인증을 안 만드나**: 레이아웃이 이미 `tradingAccess()` 로 소유자를 거른다.
// 여기서 제 나름의 확인을 만들면 두 판정이 갈리고, 갈린 결과가
// 「화면은 열리는데 창구가 403」 이거나 그 반대다. 같은 함수를 부른다.

import { revalidatePath } from 'next/cache'
import { tradingAccess } from '@/lib/trading/access'
import { applyAck, markOpened } from '@/lib/trading/signal/ack'
import { ACK_ACTIONS, type AckAction } from '@/lib/trading/signal/ack-policy'
import { loadTradingSettings, saveTradingSetting } from '@/lib/trading/settings/store'
import { loadTradingOverview } from '@/lib/trading/overview'
import { decideEnableNotify, decideDisableNotify, auditLine } from '@/lib/trading/notify/enable-gate'
import { getRequestUser } from '@/lib/supabase/server'

export interface AckActionResult {
  ok: boolean
  userMessage: string | null
}

const DENIED: AckActionResult = { ok: false, userMessage: '이 화면의 소유자만 확인할 수 있습니다' }

function seoulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

async function validMinutes(today: string): Promise<number> {
  const { values } = await loadTradingSettings(today)
  const raw = Number(values.signal_valid_minutes)
  return Number.isFinite(raw) && raw > 0 ? raw : 10
}

/** 화면이 신호를 처음 그렸다 */
export async function recordSignalOpened(signalId: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  try {
    await markOpened(signalId, new Date())
    return { ok: true, userMessage: null }
  } catch (error) {
    // 열람 기록이 실패해도 화면은 살아 있어야 한다. 곁가지가 본 일을 죽이지 않는다
    return { ok: false, userMessage: error instanceof Error ? error.message : '열람을 적지 못했습니다' }
  }
}

/** 단추 셋 중 하나를 눌렀다 */
export async function submitSignalAck(
  signalId: string, action: string, stopValue?: string,
): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  if (!ACK_ACTIONS.includes(action as AckAction)) {
    return { ok: false, userMessage: '모르는 동작입니다' }
  }
  const now = new Date()
  const outcome = await applyAck({
    signalId,
    action: action as AckAction,
    stopValue,
    now,
    validMinutes: await validMinutes(seoulToday(now)),
  })
  if (!outcome.ok) return { ok: false, userMessage: outcome.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: null }
}

/**
 * 알림을 켜고 끈다 (C4 · §15.3).
 *
 * 켜기는 검증 관문과 섀도 일수를 지나야 하고, 끄기는 언제나 된다 —
 * 대칭으로 만들면 관문이 깨진 날 끄지도 못한다.
 *
 * 켜고 끈 일은 그때의 관문 상태와 함께 기록에 남는다. 나중에 「왜 켰나」를 물을 때 답이 된다.
 */
export async function setNotifyEnabled(next: boolean): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  const now = new Date()
  const today = seoulToday(now)
  const overview = await loadTradingOverview(now)
  const ctx = {
    gatePassed: overview.gate.passed,
    gateInsufficientCount: overview.gate.insufficientCount,
    gateFailedCount: overview.gate.failedCount,
    shadowTradeDays: overview.notify.shadowTradeDays,
    requiredShadowDays: overview.notify.requiredShadowDays,
    currentlyEnabled: overview.notify.enabled,
  }
  const actor = { kind: 'human' as const, userId: user.id }
  const decision = next ? decideEnableNotify(actor, ctx) : decideDisableNotify(actor)
  if (!decision.allowed) return { ok: false, userMessage: decision.userMessage }

  const saved = await saveTradingSetting({
    key: 'notify_enabled',
    value: next,
    source: 'admin',
    changedBy: user.id,
    effectiveTradeDate: today,
    // 무엇을 왜 했는지가 남는다. 사유가 없으면 나중에 「왜 켰나」에 답할 것이 없다
    reason: auditLine({
      action: next ? 'enable' : 'disable',
      actorUserId: user.id,
      at: now,
      gatePassed: ctx.gatePassed,
      shadowTradeDays: ctx.shadowTradeDays,
    }),
  })
  if (!saved.ok) return { ok: false, userMessage: saved.rejection.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: null }
}
