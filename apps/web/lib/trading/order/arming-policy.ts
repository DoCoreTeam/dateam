/**
 * 무장 관문 — **켜는 것과 켜져 있는 것이 다른 상태다** (설계 §1·§2)
 *
 * ## 왜 설정이 아니라 상태인가
 *
 * 설정 하나로 켜고 끄면 그 설정은 다른 설정들과 같은 무게로 보인다. 화면에서 스무 개 값 중
 * 하나이고, 잘못 눌러도 화면은 아무 일 없어 보인다. **그런데 그 하나가 돈을 움직인다.**
 *
 * 그래서 기본이 해제이고, 만료가 있고, 사람만 하고, 해제는 언제나 된다.
 *
 * ## 왜 무장할 때와 주문할 때 두 번 재나
 *
 * 무장은 하루를 간다. 그 사이에 관문이 깨질 수 있다 — 조회가 끊기고, 대조가 어긋나고,
 * 게이트가 걸린다. 무장할 때 한 번만 재면 「아침에 멀쩡했으니 하루 종일 멀쩡하다」가 된다.
 */

export const ARM_CHECKS = [
  'A1_gate_passed', 'A2_notify_enabled', 'A3_paper_days',
  'A4_reconciled', 'A5_no_gate_fail', 'A6_risk_within_limit',
  /** 실계좌에만 더 필요하다 */
  'A7_paper_expectancy_positive',
] as const
export type ArmCheck = (typeof ARM_CHECKS)[number]

export const ARM_CHECK_LABEL: Record<ArmCheck, string> = {
  A1_gate_passed: '검증 관문 통과',
  A2_notify_enabled: '알림 켜짐',
  A3_paper_days: '모의 자동 주문 거래일',
  A4_reconciled: '계좌와 기록 일치',
  A5_no_gate_fail: '오늘 안전 게이트 실패 0건',
  A6_risk_within_limit: '1회 위험이 일일 한도 안',
  A7_paper_expectancy_positive: '모의 순손익 하한 > 0',
}

export type ArmEnv = 'paper' | 'real'

export interface ArmContext {
  env: ArmEnv
  /** A1 */
  gatePassed: boolean
  gateInsufficient: number
  /** A2 */
  notifyEnabled: boolean
  /** A3 — 모의로 자동 주문을 돌린 거래일 수 */
  paperAutoDays: number
  requiredPaperDays: number
  /** A4 */
  reconciliationRequired: boolean
  /** A5 — 오늘 실패한 게이트 수 */
  gateFailCount: number
  /** A6 */
  riskPerTradeKrw: number
  dailyLossLimitKrw: number
  /** A7 — 모의 실적의 순손익 하한(R). 못 쟀으면 null */
  paperExpectancyLowerR: number | null
}

export interface ArmBlock {
  check: ArmCheck
  reason: string
  userMessage: string
}

export type ArmDecision =
  | { allowed: true }
  /** **무엇이 모자란지를 전부** 돌려준다. 하나씩 주면 고치고 다시 걸리고를 반복한다 */
  | { allowed: false; blocks: ArmBlock[] }

function block(check: ArmCheck, reason: string, userMessage: string): ArmBlock {
  return { check, reason, userMessage }
}

/**
 * 무장해도 되나.
 *
 * 모의(`paper`)는 A1~A6, 실계좌(`real`)는 A7 까지. 실계좌가 더 필요한 이유는
 * 「돌려 봤다」와 「남았다」가 다르기 때문이다.
 */
export function checkArming(ctx: ArmContext): ArmDecision {
  const blocks: ArmBlock[] = []

  if (ctx.gateInsufficient > 0) {
    blocks.push(block('A1_gate_passed', `gate_insufficient:${ctx.gateInsufficient}`,
      `검증 관문에서 아직 못 잰 항목이 ${ctx.gateInsufficient}개 있습니다`))
  } else if (!ctx.gatePassed) {
    blocks.push(block('A1_gate_passed', 'gate_not_passed', '검증 관문을 통과하지 못했습니다'))
  }

  if (!ctx.notifyEnabled) {
    // 무장은 사람을 대신하는 것이 아니라 손을 빌려주는 것이다. 사람이 보고 있어야 한다
    blocks.push(block('A2_notify_enabled', 'notify_off',
      '알림이 꺼져 있습니다. 사람이 신호를 보고 있어야 무장할 수 있습니다'))
  }

  if (ctx.paperAutoDays < ctx.requiredPaperDays) {
    blocks.push(block('A3_paper_days', `paper_days:${ctx.paperAutoDays}`,
      `모의 자동 주문이 ${ctx.paperAutoDays}일입니다. ${ctx.requiredPaperDays}일이 필요합니다`))
  }

  if (ctx.reconciliationRequired) {
    blocks.push(block('A4_reconciled', 'reconciliation_required',
      '계좌와 기록이 다릅니다. 어긋난 채로 주문하면 어긋남이 두 배가 됩니다'))
  }

  if (ctx.gateFailCount > 0) {
    blocks.push(block('A5_no_gate_fail', `gate_fail:${ctx.gateFailCount}`,
      `오늘 안전 게이트가 ${ctx.gateFailCount}건 실패했습니다`))
  }

  if (!(ctx.dailyLossLimitKrw > 0) || ctx.riskPerTradeKrw > ctx.dailyLossLimitKrw) {
    blocks.push(block('A6_risk_within_limit',
      `risk:${ctx.riskPerTradeKrw}>${ctx.dailyLossLimitKrw}`,
      '1회 위험이 일일 손실 한도보다 큽니다. 한 번에 한도를 넘을 수 있으면 한도가 아닙니다'))
  }

  if (ctx.env === 'real') {
    if (ctx.paperExpectancyLowerR === null) {
      blocks.push(block('A7_paper_expectancy_positive', 'no_paper_expectancy',
        '모의 실적을 아직 못 쟀습니다'))
    } else if (ctx.paperExpectancyLowerR <= 0) {
      blocks.push(block('A7_paper_expectancy_positive', `lower:${ctx.paperExpectancyLowerR}`,
        '모의에서 남지 않았습니다. 「돌려 봤다」와 「남았다」는 다릅니다'))
    }
  }

  return blocks.length === 0 ? { allowed: true } : { allowed: false, blocks }
}

// ── 무장 상태 ────────────────────────────────────────────

export interface ArmState {
  armed: boolean
  expiresAt: Date
  armedBy: string | null
}

/**
 * 지금 주문을 낼 수 있는 상태인가.
 *
 * **만료를 따로 본다.** `armed` 가 참이어도 만료가 지났으면 무장이 아니다 —
 * 스스로 풀리는 것이 사람이 끄는 것보다 확실하다.
 */
export function isArmed(state: ArmState, now: Date): boolean {
  if (!state.armed) return false
  if (state.expiresAt.getTime() <= now.getTime()) return false
  return state.armedBy !== null
}

/** 기본 무장 시간(시간). 켜 놓고 잊는 일을 구조가 막는다 */
export const DEFAULT_ARM_HOURS = 24

export function expiryFrom(now: Date, hours: number): Date {
  const safe = Number.isFinite(hours) && hours > 0 ? Math.min(hours, DEFAULT_ARM_HOURS) : DEFAULT_ARM_HOURS
  return new Date(now.getTime() + safe * 3_600_000)
}

/**
 * 해제는 **언제나** 된다.
 *
 * 켜는 쪽과 대칭으로 만들면 관문이 깨진 날 끄지도 못한다.
 */
export function mayDisarm(): { allowed: true } {
  return { allowed: true }
}

/** 못 무장하는 이유 한 줄. 화면이 흐린 단추에 붙인다 */
export function armingHint(decision: ArmDecision): string {
  if (decision.allowed) return '무장할 수 있습니다'
  return decision.blocks.map((b) => b.userMessage).join(' · ')
}
