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
import { decideProposal } from '@/lib/trading/knowledge/proposal'
import { ingestSource, ingestUrl } from '@/lib/trading/knowledge/sources'
import { decideToggleNight } from '@/lib/trading/calendar/night-signal'
import { arm, disarm } from '@/lib/trading/order/arming'
import { cancelOrder } from '@/lib/trading/order/place'
import { loadAccountRef, loadAppCredential } from '@/lib/trading/broker/credentials'
import { getAccessToken } from '@/lib/trading/broker/token'
import { isNightHour } from '@/lib/trading/calendar/session'
import { addEvent, removeEvent, listEvents, type EventRow } from '@/lib/trading/calendar/events'
import { type ArmEnv } from '@/lib/trading/order/arming-policy'

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

/**
 * 설정 변경 제안을 사람이 결정한다 (§15.3).
 *
 * AI 는 올리기만 하고 여기를 못 부른다 — 서버 액션이라 사람의 요청으로만 들어온다.
 */
export async function decideSpecCandidate(proposalId: string, accept: boolean): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  const result = await decideProposal({ proposalId, accept, actorUserId: user.id })
  if (!result.ok) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return {
    ok: true,
    userMessage: result.applied
      ? `${result.effectiveTradeDate} 부터 적용됩니다`
      : '후보를 물렸습니다',
  }
}

/**
 * 자료를 넣는다. 주소처럼 보이면 받아 오고, 아니면 붙여 넣은 글로 본다.
 *
 * 분석은 여기서 안 한다 — 크론이 다음 분에 한다. 넣기와 분석을 묶으면
 * AI 가 죽은 날 자료까지 못 받는다.
 */
export async function addTradingSource(text: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const body = text.trim()
  if (body === '') return { ok: false, userMessage: '자료가 비어 있습니다' }

  const looksLikeUrl = /^https?:\/\/\S+$/.test(body)
  const result = looksLikeUrl
    ? await ingestUrl(body)
    : await ingestSource({ kind: 'text', ref: '붙여 넣은 글', rawText: body })

  if (!result.stored) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: '자료를 넣었습니다. 곧 분석합니다' }
}

/**
 * 야간 신호를 켜고 끈다.
 *
 * 켜려면 야간 표본으로 관문을 통과해야 하고, **끄는 것은 언제나 된다** —
 * 대칭으로 만들면 야간에 문제가 생긴 날 끄지도 못한다.
 */
export async function setNightSignalEnabled(next: boolean): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  const now = new Date()
  const today = seoulToday(now)
  const overview = await loadTradingOverview(now)
  const { values } = await loadTradingSettings(today)

  const decision = decideToggleNight(next, {
    nightGatePassed: overview.gate.passed && overview.gate.insufficientCount === 0,
    nightShadowDays: 0,
    requiredShadowDays: Number(values.night_shadow_days_required) || 5,
  })
  if (!decision.allowed) return { ok: false, userMessage: decision.userMessage }

  const saved = await saveTradingSetting({
    key: 'night_signal_enabled',
    value: next,
    source: 'admin',
    changedBy: user.id,
    effectiveTradeDate: today,
    reason: `야간 신호 ${next ? '켬' : '끔'} · 사용자 ${user.id}`,
  })
  if (!saved.ok) return { ok: false, userMessage: saved.rejection.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: next ? '야간 신호를 켰습니다' : '야간 신호를 껐습니다' }
}

/**
 * 자동 주문을 무장하고 해제한다 (Release 4 설계 §1·§2).
 *
 * 무장은 **사람만** 한다. 서버 액션이라 사람의 요청으로만 들어오고,
 * 그 안에서 `arm()` 이 사용자 ID 를 필수로 받는다.
 *
 * 해제는 관문과 무관하게 언제나 된다 — 대칭으로 만들면 문제가 생긴 날 끄지도 못한다.
 */
export async function setAutoOrderArmed(next: boolean): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  const now = new Date()
  const today = seoulToday(now)
  const { values } = await loadTradingSettings(today)
  const env = (String(values.kis_env ?? 'real') === 'paper' ? 'paper' : 'real') as ArmEnv

  if (!next) {
    await disarm({ env, reason: 'human_disarmed', actorUserId: user.id, now })
    revalidatePath('/trading')
    return { ok: true, userMessage: '해제했습니다' }
  }

  const overview = await loadTradingOverview(now)
  const result = await arm({
    env,
    actorUserId: user.id,
    now,
    hours: Number(values.order_arm_hours) || 24,
    ctx: {
      env,
      gatePassed: overview.gate.passed,
      gateInsufficient: overview.gate.insufficientCount,
      notifyEnabled: overview.notify.enabled,
      /**
       * 모의 자동 주문 일수를 아직 안 센다. **0 으로 둔다** — 0 이면 관문이 막고,
       * 그것이 지금 정확한 상태다(모의로 한 번도 안 돌려 봤다)
       */
      paperAutoDays: 0,
      requiredPaperDays: Number(values.order_required_paper_days) || 20,
      reconciliationRequired: overview.position?.needsHumanUnlock === true,
      gateFailCount: overview.gate.failedCount,
      riskPerTradeKrw: 0,
      dailyLossLimitKrw: Number(values.daily_loss_limit_krw) || 0,
      paperExpectancyLowerR: null,
    },
  })
  if (!result.armed) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: '무장했습니다' }
}

/**
 * 미체결 주문을 취소한다 — **사람이 누를 때만**.
 *
 * 해제는 주문을 안 건드린다(설계 §6). 남은 것은 여기서 지운다.
 * 취소는 위험을 줄이는 쪽이라 무장 여부를 안 본다.
 */
export async function cancelAutoOrder(orderId: string, brokerOrderNo: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  const now = new Date()
  const today = seoulToday(now)
  const { values } = await loadTradingSettings(today)
  const env = (String(values.kis_env ?? 'real') === 'paper' ? 'paper' : 'real') as ArmEnv

  const acct = await loadAccountRef(env, String(values.kis_account_product_code ?? '03'))
  const credential = await loadAppCredential(env)
  if (!acct || !credential) {
    return { ok: false, userMessage: '증권사 계좌나 앱키가 등록되지 않았습니다' }
  }
  const token = await getAccessToken({
    env,
    refreshMarginMinutes: Number(values.kis_token_refresh_margin_minutes) || 30,
    runId: `cancel:${orderId}`,
    now,
  })
  if (!token.ok) return { ok: false, userMessage: token.userMessage }

  const result = await cancelOrder({
    env,
    session: isNightHour(now) ? 'night' : 'day',
    auth: { accessToken: token.accessToken, appKey: credential.appKey, appSecret: credential.appSecret },
    acct,
    orderId,
    brokerOrderNo,
    actorUserId: user.id,
    now,
  })
  if (!result.cancelled) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: '취소했습니다' }
}

// ── 이벤트 캘린더 (§6.6) ──────────────────────────────────

/**
 * 이벤트를 더한다.
 *
 * **새 인증을 안 만든다** — 위의 창구들과 같은 `tradingAccess` 를 부른다.
 * 여기서 제 나름의 확인을 만들면 두 판정이 갈리고, 갈린 결과가
 * 「화면은 열리는데 창구가 403」 이거나 그 반대다.
 */
export async function addTradingEvent(name: string, occursAtLocal: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  /**
   * 화면이 주는 것은 `YYYY-MM-DDTHH:mm` 이고 시간대가 없다. 그대로 `new Date` 에 넣으면
   * 브라우저가 아니라 **서버의 시간대**로 읽혀 아홉 시간 어긋난다. KST 로 못을 박는다.
   */
  const anchored = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occursAtLocal)
    ? `${occursAtLocal}:00+09:00`
    : occursAtLocal
  const result = await addEvent({ name, occursAt: anchored })
  if (!result.ok) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: null }
}

/** 이벤트를 지운다. 되돌리기를 안 두는 이유: 다시 넣으면 그만이다 */
export async function removeTradingEvent(id: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const result = await removeEvent(id)
  if (!result.ok) return { ok: false, userMessage: result.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: null }
}

/** 화면이 그릴 목록 */
export async function loadTradingEvents(): Promise<EventRow[]> {
  if (!(await tradingAccess()).allowed) return []
  return listEvents()
}
