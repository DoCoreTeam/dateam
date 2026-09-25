/**
 * 안전 게이트 — **신호 규칙보다 먼저 본다** (명세 §10)
 *
 * ## 왜 규칙보다 먼저인가
 *
 * 신호 규칙은 「이 거래가 좋은가」를 묻고, 안전 게이트는 「지금 우리가 판단할 수 있는
 * 상태인가」를 묻는다. 순서를 바꾸면 **데이터가 깨진 상태에서 좋은 거래를 찾아낸다.**
 * 좋아 보이는 것이 문제다 — 나쁜 값이면 아무도 안 따를 텐데, 그럴듯한 값이면 따른다.
 *
 * ## 끄는 설정이 없다
 *
 * 명세가 「게이트를 끄는 설정은 없다」고 적는다. 끌 수 있으면 급할 때 끄고,
 * 급한 순간이 정확히 게이트가 필요한 순간이다.
 * 기준값(몇 초, 몇 건)은 설정이지만 **게이트 자체를 끄는 값은 없다.**
 *
 * ## 열린 포지션 감시는 안 멈춘다 (§10.2)
 *
 * 게이트가 걸려도 막는 것은 **새 신호**뿐이다. 이미 들고 있는 것의 손절·청산 감시는
 * 어떤 경우에도 계속한다 — 멈추면 그 포지션은 아무도 안 보는 채로 남는다.
 */

export type GateId =
  | 'SG-01' | 'SG-02' | 'SG-03' | 'SG-04' | 'SG-05' | 'SG-06'
  | 'SG-07' | 'SG-08' | 'SG-09' | 'SG-10' | 'SG-11' | 'SG-12'

export interface GateHit {
  id: GateId
  /** 기계가 읽는 사유 */
  reason: string
  /** 사람이 읽을 한 줄 */
  userMessage: string
}

/** 게이트가 보는 지금 상태. 모르는 값은 null 이고, **null 은 안전으로 치지 않는다** */
export interface SafetyContext {
  /** 직전 봉이 결측이거나 늦었나 */
  barMissingOrLate: boolean
  /** 스프레드가 평소보다 이상하게 넓은가 */
  spreadAbnormal: boolean
  /** KIS 조회·토큰 연속 실패 수 */
  brokerFailureStreak: number
  /** 마지막 크론 실행 이후 지난 분 */
  minutesSinceLastRun: number | null
  /** 기록과 계좌가 다른가 */
  reconciliationRequired: boolean
  /** 포지션이 있는가 */
  hasPosition: boolean
  /** 손절 보호 상태 */
  protectionState: 'none' | 'unknown' | 'user_reported' | 'breached'
  /** 알림 발송 연속 실패 수 */
  notifyFailureStreak: number
  /** 최근 신호 중 아무도 안 열어 본 연속 수 */
  unopenedSignalStreak: number
  /** 보정 모델과 활성 스펙이 있나 */
  hasCalibration: boolean
  hasActiveSpec: boolean
  /** 증거금이 모자라거나 유지증거금에 가까운가 */
  marginTight: boolean
  /** AI 예산이 다 찼나 */
  aiBudgetExhausted: boolean
  /** 시장 상태 이상(서킷브레이커·사이드카·가격제한 근접·거래 정지·동시호가) */
  marketAbnormal: boolean
  /** 장중에 트레이딩 로직 판이 바뀌었나 (§14.4) */
  logicChangedToday: boolean
}

export interface SafetyThresholds {
  /** 이만큼 연속 실패하면 SG-02 */
  maxBrokerFailureStreak: number
  /** 크론이 이만큼 안 돌면 SG-03 */
  maxMinutesSinceRun: number
  /** 알림이 이만큼 연속 실패하면 SG-06 */
  maxNotifyFailureStreak: number
  /** 이만큼 연속으로 아무도 안 열면 SG-07 */
  maxUnopenedSignals: number
}

/**
 * 걸린 게이트 전부 — **첫 번째에서 멈추지 않는다.**
 *
 * 하나만 돌려주면 그것을 고치고 다시 돌렸을 때 다음 게이트가 나온다.
 * 한 번에 다 보여 줘야 무엇이 문제인지 한 번에 안다.
 */
export function checkSafetyGates(
  ctx: SafetyContext,
  t: SafetyThresholds,
): GateHit[] {
  const hits: GateHit[] = []
  const hit = (id: GateId, reason: string, userMessage: string) => hits.push({ id, reason, userMessage })

  if (ctx.barMissingOrLate || ctx.spreadAbnormal) {
    hit('SG-01',
      `bar_or_spread:missing=${ctx.barMissingOrLate},spread=${ctx.spreadAbnormal}`,
      '봉이 늦거나 빠졌거나 호가가 이상합니다. 그 값으로 판단하지 않습니다')
  }
  if (ctx.brokerFailureStreak >= t.maxBrokerFailureStreak) {
    hit('SG-02', `broker_failures:${ctx.brokerFailureStreak}`,
      `증권사 조회가 ${ctx.brokerFailureStreak}번 연속 실패했습니다`)
  }
  if (ctx.minutesSinceLastRun === null || ctx.minutesSinceLastRun > t.maxMinutesSinceRun) {
    // **모르는 것을 안전으로 치지 않는다.** 마지막 실행을 모른다는 것은 안 돌았을 수도 있다는 뜻이다
    hit('SG-03', `cron_stale:${ctx.minutesSinceLastRun ?? 'unknown'}`,
      '정해진 시간 안에 수집이 돌지 않았습니다')
  }
  if (ctx.reconciliationRequired) {
    hit('SG-04', 'reconciliation_required',
      '시스템 기록과 증권사 계좌가 다릅니다. 화면에서 확인해 주세요')
  }
  if (ctx.hasPosition && (ctx.protectionState === 'unknown' || ctx.protectionState === 'breached')) {
    hit('SG-05', `protection:${ctx.protectionState}`,
      ctx.protectionState === 'breached'
        ? '손절가를 지났는데 포지션이 남아 있습니다'
        : '포지션이 있는데 손절이 걸렸는지 모릅니다')
  }
  if (ctx.notifyFailureStreak >= t.maxNotifyFailureStreak) {
    hit('SG-06', `notify_failures:${ctx.notifyFailureStreak}`,
      '알림이 이어서 실패하고 있습니다. 신호를 내도 닿지 않습니다')
  }
  if (ctx.unopenedSignalStreak >= t.maxUnopenedSignals) {
    hit('SG-07', `unopened:${ctx.unopenedSignalStreak}`,
      `최근 신호 ${ctx.unopenedSignalStreak}건을 아무도 열어 보지 않았습니다`)
  }
  if (!ctx.hasCalibration || !ctx.hasActiveSpec) {
    hit('SG-08', `missing:calibration=${ctx.hasCalibration},spec=${ctx.hasActiveSpec}`,
      '보정 모델이나 활성 스펙이 없습니다. 보정 없이는 신호를 내지 않습니다')
  }
  if (ctx.marginTight) {
    hit('SG-09', 'margin_tight', '증거금이 모자라거나 유지증거금에 가깝습니다')
  }
  if (ctx.aiBudgetExhausted) {
    hit('SG-10', 'ai_budget_exhausted', 'AI 예산을 다 썼습니다')
  }
  if (ctx.marketAbnormal) {
    hit('SG-11', 'market_abnormal', '시장 상태가 평소와 다릅니다 (거래 정지·가격제한·동시호가 등)')
  }
  if (ctx.logicChangedToday) {
    hit('SG-12', 'logic_changed_today',
      '장중에 판단 코드가 바뀌었습니다. 바뀐 규칙은 다음 거래일부터 적용합니다')
  }
  return hits
}

/** 새 신호를 내도 되나 */
export function newSignalAllowed(hits: readonly GateHit[]): boolean {
  return hits.length === 0
}

// ── 우선순위 (§10.2) ─────────────────────────────────────

export type WatchTask =
  | 'open_position_risk'
  | 'protection'
  | 'daily_loss_limit'
  | 'session_close'
  | 'profit_target'
  | 'new_signal'

/** 매분 이 순서로 본다. 앞의 것이 뒤의 것보다 먼저다 */
export const WATCH_ORDER: readonly WatchTask[] = [
  'open_position_risk', 'protection', 'daily_loss_limit',
  'session_close', 'profit_target', 'new_signal',
]

export interface WatchContext {
  hasPosition: boolean
  /** 오늘 실현 손익이 목표에 닿았나 */
  profitTargetReached: boolean
  /** 게이트가 하나라도 걸렸나 */
  gateBlocked: boolean
}

/**
 * 이번 분에 할 일들.
 *
 * **열린 포지션 감시는 어떤 경우에도 빠지지 않는다** — 게이트가 걸려도, 수익 목표를
 * 채웠어도. 빠지면 그 포지션은 아무도 안 보는 채로 남고, 손절가를 지나도 모른다.
 */
export function watchTasks(ctx: WatchContext): WatchTask[] {
  const tasks: WatchTask[] = []
  for (const task of WATCH_ORDER) {
    if (task === 'new_signal') {
      // 수익 목표 도달은 **새 신호만** 멈춘다(§9.1 · §10.2)
      if (ctx.profitTargetReached || ctx.gateBlocked) continue
      tasks.push(task)
      continue
    }
    if ((task === 'open_position_risk' || task === 'protection') && !ctx.hasPosition) continue
    tasks.push(task)
  }
  return tasks
}
