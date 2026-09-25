/**
 * 게이트가 볼 값들 — **재는 규칙은 순수하게**
 *
 * ## 모르는 것을 「괜찮다」로 바꾸지 않는다
 *
 * 이 게이트들은 전부 `false` 가 「막을 이유 없음」이다. 못 잰 값을 `false` 로 채우면
 * 화면에는 「이상 없음」이 뜨고 실제로는 **아무도 안 재고 있다.** 실측 2026-09-26:
 * `hasCalibration`·`hasActiveSpec`·`marginTight`·`aiBudgetExhausted` 네 개가
 * 크론에서 통째로 `false` 로 넘어가고 있었다. SG-08 은 한 번도 안 걸렸다.
 *
 * 그래서 못 잰 것은 `false` 로 넘기되 **못 쟀다는 사실을 따로 들고** 실행 기록에 남긴다.
 * 조용히 통과한 것과 재 보고 통과한 것은 다른 사실이다.
 */

export interface MarginInput {
  /** 추가 증거금(마진콜). 0 이 아니면 위험하다 */
  additionalMarginKrw: number | null
  /** 위탁증거금 유지율(%) */
  maintenanceRate: number | null
  /** 이 밑으로 내려가면 빡빡하다고 본다 */
  tightRatePercent: number
}

/**
 * 증거금이 빡빡한가.
 *
 * 둘 다 못 읽으면 **`null`(모름)** 이다. `false`(여유 있음)와 다르다 —
 * KIS 가 답을 안 준 날 「증거금 넉넉함」이라고 화면에 쓰면 그것은 지어낸 사실이다.
 */
export function marginTightFrom(input: MarginInput): boolean | null {
  const additional = Number.isFinite(input.additionalMarginKrw as number)
    ? (input.additionalMarginKrw as number) : null
  const rate = Number.isFinite(input.maintenanceRate as number)
    ? (input.maintenanceRate as number) : null
  if (additional === null && rate === null) return null
  // 마진콜이 걸렸으면 유지율을 볼 것도 없다
  if (additional !== null && additional > 0) return true
  if (rate !== null && rate < input.tightRatePercent) return true
  return false
}

/** 마지막 실행 이후 지난 분. 실행 기록이 없으면 null — 0 이 아니다 */
export function minutesSince(lastRunAt: Date | null, now: Date): number | null {
  if (!lastRunAt) return null
  const minutes = (now.getTime() - lastRunAt.getTime()) / 60_000
  return Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : null
}

export interface GateMeasurement {
  brokerFailureStreak: number
  minutesSinceLastRun: number | null
  hasCalibration: boolean
  hasActiveSpec: boolean
  marginTight: boolean
  aiBudgetExhausted: boolean
  /** 못 잰 것들. 비어 있어야 정상이고, 비어 있지 않으면 실행 기록에 뜬다 */
  unmeasured: string[]
}

/**
 * 못 잰 값을 게이트 꼴로 접는다.
 *
 * `null` 은 게이트에 `false` 로 넘어간다 — 모른다고 새 신호를 막으면
 * KIS 가 답을 늦게 준 날 하루가 통째로 멈춘다. 대신 **못 쟀다는 것을 남긴다.**
 */
export function foldMeasurement(raw: {
  brokerFailureStreak: number
  minutesSinceLastRun: number | null
  hasCalibration: boolean | null
  hasActiveSpec: boolean | null
  marginTight: boolean | null
  aiBudgetExhausted: boolean | null
}): GateMeasurement {
  const unmeasured: string[] = []
  const known = (name: string, value: boolean | null): boolean => {
    if (value === null) { unmeasured.push(name); return false }
    return value
  }
  if (raw.minutesSinceLastRun === null) unmeasured.push('minutesSinceLastRun')
  return {
    brokerFailureStreak: raw.brokerFailureStreak,
    minutesSinceLastRun: raw.minutesSinceLastRun,
    hasCalibration: known('hasCalibration', raw.hasCalibration),
    hasActiveSpec: known('hasActiveSpec', raw.hasActiveSpec),
    marginTight: known('marginTight', raw.marginTight),
    aiBudgetExhausted: known('aiBudgetExhausted', raw.aiBudgetExhausted),
    unmeasured,
  }
}

/** 실행 기록에 실을 한 줄 */
export function measurementNote(m: GateMeasurement): string {
  const parts = [
    `broker_fail=${m.brokerFailureStreak}`,
    `since_run=${m.minutesSinceLastRun ?? 'unknown'}`,
    `calib=${m.hasCalibration}`,
    `spec=${m.hasActiveSpec}`,
    `margin_tight=${m.marginTight}`,
    `ai_budget_out=${m.aiBudgetExhausted}`,
  ]
  if (m.unmeasured.length > 0) parts.push(`unmeasured=${m.unmeasured.join('+')}`)
  return `gate(${parts.join(',')})`
}
