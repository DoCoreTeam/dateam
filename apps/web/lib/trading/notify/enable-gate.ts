/**
 * 알림 켜기 관문 — **검증이 먼저다** (명세 C4 · §3.2)
 *
 * ## 왜 켜는 것을 막나
 *
 * 알림을 켜면 사람이 그걸 보고 실제 돈을 넣는다. 그 전에 확인해야 하는 것은
 * 「비용과 지연을 뺀 뒤에도 기대값이 양수인가」이고, 그것을 확인하는 장치가 검증 관문(§13.5)이다.
 * 관문을 안 지나고 켜면 **켠 그 순간부터 우리는 모르는 것을 권하고 있다.**
 *
 * ## 왜 섀도 거래일까지 세나
 *
 * 백테스트가 통과해도 실시간에서는 다르다 — 봉이 늦게 오고, 조회가 실패하고,
 * 사람이 늦게 본다. 그 지연이 들어간 판을 며칠 돌려 봐야 한다.
 * 그래서 관문 통과와 섀도 일수를 **둘 다** 본다. 하나로는 못 켠다.
 *
 * ## 왜 AI 가 못 켜나 (§15.3)
 *
 * 「AI 가 절대 바꿀 수 없는 것」 목록에 안전 게이트와 Lockbox 열기가 있다.
 * 알림 켜기는 그 둘의 결과를 실제 돈으로 바꾸는 스위치라 같은 자리에 둔다.
 * 사람만 켠다.
 */

/** 누가 켜려 하나. AI 는 못 켠다 */
export type EnableActor =
  | { kind: 'human'; userId: string }
  | { kind: 'ai'; lane: string }

export interface EnableContext {
  /** 검증 관문이 통과했나 (§13.5) */
  gatePassed: boolean
  /** 관문에서 아직 못 잰 항목 수. 0 이 아니면 「미달」이 아니라 「모른다」다 */
  gateInsufficientCount: number
  /** 관문에서 미달한 항목 수 */
  gateFailedCount: number
  /** 실시간 섀도를 돌린 거래일 수 */
  shadowTradeDays: number
  /** 설정 `notify_shadow_days_required` */
  requiredShadowDays: number
  /** 지금 켜져 있나 */
  currentlyEnabled: boolean
}

export const BLOCK_REASONS = [
  'ai_cannot_enable', 'gate_not_passed', 'gate_insufficient', 'not_enough_shadow_days',
] as const
export type BlockReason = (typeof BLOCK_REASONS)[number]

export type EnableDecision =
  | { allowed: true }
  /** **무엇이 모자란지**를 말한다. 「안 됩니다」만으로는 뭘 해야 하는지 모른다 */
  | { allowed: false; reason: BlockReason; userMessage: string }

/**
 * 알림을 켜도 되나.
 *
 * 막힌 것을 전부가 아니라 **가장 앞선 하나**만 말한다 — 끄는 쪽과 달리 켜는 쪽은
 * 한 번에 하나씩 해결하는 일이고, 넷을 한꺼번에 보여 주면 어디서 시작할지 모른다.
 */
export function decideEnableNotify(actor: EnableActor, ctx: EnableContext): EnableDecision {
  if (actor.kind !== 'human') {
    return {
      allowed: false, reason: 'ai_cannot_enable',
      userMessage: '알림 켜기는 사람만 할 수 있습니다',
    }
  }
  if (ctx.gateInsufficientCount > 0) {
    return {
      allowed: false, reason: 'gate_insufficient',
      userMessage: `검증 관문에서 아직 못 잰 항목이 ${ctx.gateInsufficientCount}개 있습니다. 표본이 더 쌓여야 합니다`,
    }
  }
  if (!ctx.gatePassed) {
    return {
      allowed: false, reason: 'gate_not_passed',
      userMessage: `검증 관문을 통과하지 못했습니다. 미달 ${ctx.gateFailedCount}개를 먼저 해결해 주세요`,
    }
  }
  if (ctx.shadowTradeDays < ctx.requiredShadowDays) {
    return {
      allowed: false, reason: 'not_enough_shadow_days',
      userMessage: `실시간 섀도가 ${ctx.shadowTradeDays}일입니다. ${ctx.requiredShadowDays}일이 필요합니다`,
    }
  }
  return { allowed: true }
}

/**
 * 끄는 것은 언제나 된다.
 *
 * 켜는 것과 대칭으로 만들면 「관문이 깨진 날 끄지도 못하는」 상태가 생긴다.
 * 위험을 줄이는 쪽은 막지 않는다.
 */
export function decideDisableNotify(actor: EnableActor): EnableDecision {
  if (actor.kind !== 'human') {
    return {
      allowed: false, reason: 'ai_cannot_enable',
      userMessage: '알림 끄기는 사람만 할 수 있습니다',
    }
  }
  return { allowed: true }
}

/** 켜고 끈 일의 기록 한 줄. 누가 언제 무엇을 왜 */
export interface EnableAuditEntry {
  action: 'enable' | 'disable'
  actorUserId: string
  at: Date
  /** 그때의 관문 상태. 나중에 「왜 켰나」를 물을 때 답이 된다 */
  gatePassed: boolean
  shadowTradeDays: number
}

export function auditLine(entry: EnableAuditEntry): string {
  const what = entry.action === 'enable' ? '알림 켬' : '알림 끔'
  return `${what} · 사용자 ${entry.actorUserId} · 관문 ${entry.gatePassed ? '통과' : '미통과'}`
    + ` · 섀도 ${entry.shadowTradeDays}일`
}

/**
 * 지금 상태에서 화면이 뭐라고 말할 것인가.
 *
 * 켤 수 없을 때 단추를 그냥 흐리게 두지 않는다 — 흐린 단추는 왜 못 누르는지를 안 말한다.
 */
export function enableHint(ctx: EnableContext): string {
  const decision = decideEnableNotify({ kind: 'human', userId: 'preview' }, ctx)
  if (decision.allowed) {
    return ctx.currentlyEnabled ? '알림이 켜져 있습니다' : '알림을 켤 수 있습니다'
  }
  return decision.userMessage
}
