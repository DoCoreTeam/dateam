/**
 * 점검 — **기계가 센 숫자로만 판정한다** (명세 §16 Release 3)
 *
 * ## 왜 AI 가 판정에 안 들어가나
 *
 * 「수집이 좀 이상해 보입니다」는 조치로 이어지지 않는다. 무엇이 얼마나 어긋났는지를
 * 모르면 고칠 수도, 고쳐졌는지 확인할 수도 없다. 그래서 판정은 순수 함수가 하고
 * AI 는 그 결과를 **말로 옮기기만** 한다.
 *
 * ## 왜 `unknown` 이 따로 있나
 *
 * 값을 못 읽었을 때 `ok` 로 두면 화면이 초록이 된다. 그러면 아무도 안 본다.
 * 실측 전례가 있다 — 캘린더가 안 채워져 크론이 매분 「세션 정보 없음」으로 끝났는데
 * 오류는 한 건도 안 났고, 봉이 닷새 동안 0줄이었다.
 * **모르는 것은 모른다고 적고, 그 자체가 점검 대상이다.**
 */

export const CHECK_IDS = [
  /** 어제 봉이 다 모였나 */
  'bars_complete',
  /** 크론이 제때 돌았나 */
  'cron_alive',
  /** 증권사 조회가 되나 */
  'broker_reachable',
  /** 알림이 나가고 있나 */
  'notify_flowing',
  /** 보정 모델이 있나 (없으면 신호가 영영 안 나간다) */
  'calibration_present',
  /** 검증 관문이 어디까지 왔나 */
  'gate_progress',
  /** AI 예산이 남았나 */
  'ai_budget',
  /** 계좌와 기록이 맞나 */
  'reconciled',
] as const
export type CheckId = (typeof CHECK_IDS)[number]

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown'

/** 급한 순서. 숫자가 작을수록 먼저 본다 */
export const STATUS_RANK: Record<CheckStatus, number> = {
  fail: 0, unknown: 1, warn: 2, ok: 3,
}

export interface CheckResult {
  id: CheckId
  status: CheckStatus
  /** 기계가 읽는 사유 */
  reason: string
  /** 사람이 읽을 한 줄 */
  userMessage: string
  /** 무엇을 보고 그렇게 판정했나. **숫자다** */
  measured: Record<string, number | string | boolean | null>
}

/**
 * 점검이 보는 값. **모르는 것은 `null`** 이고 `null` 은 `ok` 가 아니다.
 */
export interface CheckInput {
  /** 어제 있어야 할 봉 수와 실제 봉 수 */
  expectedBars: number | null
  actualBars: number | null
  /** 마지막 크론 실행 이후 지난 분 */
  minutesSinceRun: number | null
  /** 증권사 조회 연속 실패 수 */
  brokerFailureStreak: number | null
  /** 알림 연속 실패 수와 대기 중인 알림 수 */
  notifyFailureStreak: number | null
  pendingNotifications: number | null
  /** 보정 모델이 있나 */
  hasCalibration: boolean | null
  /** 관문 통과 여부와 아직 못 잰 항목 수 */
  gatePassed: boolean | null
  gateInsufficient: number | null
  /** 이번 달 AI 비용과 상한 */
  aiSpentKrw: number | null
  aiBudgetKrw: number | null
  /** 대조가 어긋나 잠겼나 */
  reconciliationRequired: boolean | null
  /** 문턱들 (설정) */
  thresholds: {
    maxMissingBars: number
    maxMinutesSinceRun: number
    maxBrokerFailureStreak: number
    maxNotifyFailureStreak: number
    aiBudgetWarnRatio: number
  }
}

function unknown(id: CheckId, what: string): CheckResult {
  return {
    id,
    status: 'unknown',
    reason: `no_value:${what}`,
    // 「괜찮다」가 아니라 「모른다」라고 말한다. 모르는 것을 초록으로 그리면 아무도 안 본다
    userMessage: `${what} 값을 읽지 못해 상태를 모릅니다`,
    measured: { [what]: null },
  }
}

export function checkBars(input: CheckInput): CheckResult {
  if (input.expectedBars === null || input.actualBars === null) return unknown('bars_complete', '봉 수')
  const missing = Math.max(0, input.expectedBars - input.actualBars)
  const measured = { expected: input.expectedBars, actual: input.actualBars, missing }
  if (input.expectedBars === 0) {
    return {
      id: 'bars_complete', status: 'unknown', reason: 'no_session',
      userMessage: '그날 세션 정보가 없어 봉 수를 셀 수 없습니다', measured,
    }
  }
  if (missing > input.thresholds.maxMissingBars) {
    return {
      id: 'bars_complete', status: 'fail', reason: `missing:${missing}`,
      userMessage: `봉이 ${missing}개 빠졌습니다`, measured,
    }
  }
  if (missing > 0) {
    return {
      id: 'bars_complete', status: 'warn', reason: `missing:${missing}`,
      userMessage: `봉이 ${missing}개 빠졌습니다`, measured,
    }
  }
  return {
    id: 'bars_complete', status: 'ok', reason: 'complete',
    userMessage: '봉이 다 모였습니다', measured,
  }
}

export function checkCron(input: CheckInput): CheckResult {
  if (input.minutesSinceRun === null) return unknown('cron_alive', '마지막 실행')
  const measured = { minutesSinceRun: input.minutesSinceRun }
  if (input.minutesSinceRun > input.thresholds.maxMinutesSinceRun) {
    return {
      id: 'cron_alive', status: 'fail', reason: `stale:${input.minutesSinceRun}`,
      userMessage: `수집이 ${input.minutesSinceRun}분째 안 돌았습니다`, measured,
    }
  }
  return {
    id: 'cron_alive', status: 'ok', reason: 'alive',
    userMessage: '수집이 돌고 있습니다', measured,
  }
}

export function checkBroker(input: CheckInput): CheckResult {
  if (input.brokerFailureStreak === null) return unknown('broker_reachable', '증권사 조회')
  const measured = { failureStreak: input.brokerFailureStreak }
  if (input.brokerFailureStreak >= input.thresholds.maxBrokerFailureStreak) {
    return {
      id: 'broker_reachable', status: 'fail', reason: `failures:${input.brokerFailureStreak}`,
      userMessage: `증권사 조회가 ${input.brokerFailureStreak}번 연속 실패했습니다`, measured,
    }
  }
  if (input.brokerFailureStreak > 0) {
    return {
      id: 'broker_reachable', status: 'warn', reason: `failures:${input.brokerFailureStreak}`,
      userMessage: `증권사 조회가 ${input.brokerFailureStreak}번 실패했습니다`, measured,
    }
  }
  return {
    id: 'broker_reachable', status: 'ok', reason: 'reachable',
    userMessage: '증권사 조회가 됩니다', measured,
  }
}

export function checkNotify(input: CheckInput): CheckResult {
  if (input.notifyFailureStreak === null || input.pendingNotifications === null) {
    return unknown('notify_flowing', '알림 상태')
  }
  const measured = { failureStreak: input.notifyFailureStreak, pending: input.pendingNotifications }
  if (input.notifyFailureStreak >= input.thresholds.maxNotifyFailureStreak) {
    return {
      id: 'notify_flowing', status: 'fail', reason: `failures:${input.notifyFailureStreak}`,
      userMessage: `알림이 ${input.notifyFailureStreak}번 연속 실패했습니다`, measured,
    }
  }
  if (input.pendingNotifications > 0) {
    return {
      id: 'notify_flowing', status: 'warn', reason: `pending:${input.pendingNotifications}`,
      userMessage: `아직 안 나간 알림이 ${input.pendingNotifications}건 있습니다`, measured,
    }
  }
  return {
    id: 'notify_flowing', status: 'ok', reason: 'flowing',
    userMessage: '알림이 밀리지 않았습니다', measured,
  }
}

export function checkCalibration(input: CheckInput): CheckResult {
  if (input.hasCalibration === null) return unknown('calibration_present', '보정 모델')
  const measured = { hasCalibration: input.hasCalibration }
  if (!input.hasCalibration) {
    return {
      id: 'calibration_present', status: 'warn', reason: 'no_calibration',
      // 고장이 아니다. 아직 안 만든 것이고, 그래서 신호가 안 나가는 것이 정상이다
      userMessage: '보정 모델이 없어 신호가 나가지 않습니다. 검증 단계가 먼저입니다', measured,
    }
  }
  return {
    id: 'calibration_present', status: 'ok', reason: 'present',
    userMessage: '보정 모델이 있습니다', measured,
  }
}

export function checkGate(input: CheckInput): CheckResult {
  if (input.gatePassed === null || input.gateInsufficient === null) return unknown('gate_progress', '관문')
  const measured = { passed: input.gatePassed, insufficient: input.gateInsufficient }
  if (input.gateInsufficient > 0) {
    return {
      id: 'gate_progress', status: 'warn', reason: `insufficient:${input.gateInsufficient}`,
      userMessage: `관문에서 아직 못 잰 항목이 ${input.gateInsufficient}개 있습니다`, measured,
    }
  }
  if (!input.gatePassed) {
    return {
      id: 'gate_progress', status: 'warn', reason: 'not_passed',
      userMessage: '관문을 아직 통과하지 못했습니다', measured,
    }
  }
  return {
    id: 'gate_progress', status: 'ok', reason: 'passed',
    userMessage: '관문을 통과했습니다', measured,
  }
}

export function checkAiBudget(input: CheckInput): CheckResult {
  if (input.aiSpentKrw === null || input.aiBudgetKrw === null) return unknown('ai_budget', 'AI 예산')
  const measured = { spent: input.aiSpentKrw, budget: input.aiBudgetKrw }
  if (input.aiBudgetKrw <= 0) {
    return {
      id: 'ai_budget', status: 'unknown', reason: 'no_budget_set',
      userMessage: 'AI 예산 상한이 정해지지 않아 남은 양을 모릅니다', measured,
    }
  }
  const ratio = input.aiSpentKrw / input.aiBudgetKrw
  if (ratio >= 1) {
    return {
      id: 'ai_budget', status: 'fail', reason: `exhausted:${ratio.toFixed(2)}`,
      userMessage: 'AI 예산이 다 찼습니다', measured,
    }
  }
  if (ratio >= input.thresholds.aiBudgetWarnRatio) {
    return {
      id: 'ai_budget', status: 'warn', reason: `near:${ratio.toFixed(2)}`,
      userMessage: `AI 예산을 ${(ratio * 100).toFixed(0)}% 썼습니다`, measured,
    }
  }
  return {
    id: 'ai_budget', status: 'ok', reason: `used:${ratio.toFixed(2)}`,
    userMessage: 'AI 예산에 여유가 있습니다', measured,
  }
}

export function checkReconciled(input: CheckInput): CheckResult {
  if (input.reconciliationRequired === null) return unknown('reconciled', '계좌 대조')
  const measured = { locked: input.reconciliationRequired }
  if (input.reconciliationRequired) {
    return {
      id: 'reconciled', status: 'fail', reason: 'reconciliation_required',
      userMessage: '증권사 계좌와 기록이 다릅니다. 화면에서 확인해 주세요', measured,
    }
  }
  return {
    id: 'reconciled', status: 'ok', reason: 'matched',
    userMessage: '계좌와 기록이 맞습니다', measured,
  }
}

const RUNNERS: Record<CheckId, (input: CheckInput) => CheckResult> = {
  bars_complete: checkBars,
  cron_alive: checkCron,
  broker_reachable: checkBroker,
  notify_flowing: checkNotify,
  calibration_present: checkCalibration,
  gate_progress: checkGate,
  ai_budget: checkAiBudget,
  reconciled: checkReconciled,
}

/** 전부 돈다. **하나도 건너뛰지 않는다** — 건너뛴 점검은 화면에서 「없다」와 같아 보인다 */
export function runChecks(input: CheckInput): CheckResult[] {
  return CHECK_IDS.map((id) => RUNNERS[id](input))
}

/** 급한 순서로. 같은 급이면 정의 순서 */
export function sortByUrgency(results: readonly CheckResult[]): CheckResult[] {
  return [...results].sort((a, b) => {
    const s = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (s !== 0) return s
    return CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id)
  })
}

/** 손볼 것이 있나. `unknown` 도 손볼 것이다 — 모르는 것을 그냥 두면 계속 모른다 */
export function needsAttention(results: readonly CheckResult[]): CheckResult[] {
  return sortByUrgency(results).filter((r) => r.status !== 'ok')
}
