/**
 * 신호 규칙 — **안전 게이트를 지난 뒤에 본다** (명세 §7.6)
 *
 * ## SR-01 과 SR-12 는 다른 것을 본다 (D-34)
 *
 * SR-01 은 **비용을 포함한 기대값**이 최소값 이상인가를 묻고,
 * SR-12 는 **비용을 뺀 가격 거리**가 왕복 비용의 몇 배인가를 묻는다.
 * 둘 다 「비용」이라는 말이 들어가지만 한쪽은 이미 뺀 값이고 한쪽은 안 뺀 값이다 —
 * 헷갈려서 SR-01 에서 비용을 또 빼면 이중 차감이 되고, 좋은 신호가 전부 막힌다.
 *
 * ## 보정이 없으면 신호가 없다 (M3)
 *
 * 원점수는 확률이 아니다. 보정 확률이 없으면 SR-01·SR-02 를 아예 못 재고,
 * 못 재는 것은 「통과」가 아니라 **신호 없음**이다.
 *
 * ## SR-06 은 실현 손익만 본다
 *
 * 평가 손익으로 목표 도달을 판정하면, 들고 있는 것이 잠깐 올랐다 내려가는 동안
 * 새 신호가 멈췄다 풀렸다 한다. 목표는 **닫힌 거래**로만 센다.
 */

export type RuleId =
  | 'SR-01' | 'SR-02' | 'SR-04' | 'SR-05' | 'SR-06'
  | 'SR-07' | 'SR-08' | 'SR-09' | 'SR-10' | 'SR-12'

export interface RuleBlock {
  id: RuleId
  reason: string
  userMessage: string
}

export interface SignalRuleContext {
  /** 보정된 확률. **없으면 신호 없음**(M3) */
  calibratedProb: number | null
  /** 보정 확률 구간의 실제 순손익 평균(R). 비용이 이미 들어 있다 */
  netExpectedValueR: number | null
  /** `enter_now` 의 보정 확률 */
  enterNowProb: number | null
  /** `hold` 가 가장 높은가 */
  holdDominant: boolean
  /** 개장 후 경과 분 · 마감까지 남은 분 */
  minutesSinceOpen: number
  minutesUntilClose: number
  /** 교체일이나 최종거래일인가 */
  rolloverOrExpiryDay: boolean
  /** 등록된 이벤트 전후 금지 구간인가 */
  inEventBlackout: boolean
  /** 오늘 **실현** 손익(원). 체결 기준이다 */
  realizedPnlKrw: number
  /** 1회 위험(원)과 남은 손실 여유(원) */
  riskPerTradeKrw: number
  remainingLossBudgetKrw: number
  /** 연속 손실 수와 마지막 손실 이후 지난 분 */
  consecutiveLosses: number
  minutesSinceLastLoss: number | null
  /** 오늘 이미 낸 신호 수 */
  signalsToday: number
  /** 같은 방향 마지막 신호 이후 지난 분 */
  minutesSinceSameDirection: number | null
  /** 진입가에서 목표가까지의 거리(포인트). **비용 미포함** */
  targetDistancePoints: number
  /** 왕복 비용을 포인트로 환산한 값 */
  roundTripCostPoints: number
}

export interface SignalRuleThresholds {
  /** SR-01 최소 기대값(R) */
  minNetExpectedValueR: number
  /** SR-02 `enter_now` 최소 확률 */
  minEnterNowProb: number
  /** SR-04 개장 후 금지 분 · 마감 전 금지 분 */
  openingBlockMinutes: number
  closingBlockMinutes: number
  /** SR-06 일일 목표(원) */
  dailyTargetKrw: number
  /** SR-08 연속 손실 수와 쿨다운 분 */
  cooldownAfterLosses: number
  cooldownMinutes: number
  /** SR-09 거래일 최대 신호 수 */
  maxSignalsPerDay: number
  /** SR-10 같은 방향 재신호 최소 간격(분) */
  sameDirectionGapMinutes: number
  /** SR-12 목표 거리 ÷ 왕복 비용 배수 */
  minTargetCostMultiple: number
}

/**
 * 막는 규칙 전부 — 안전 게이트와 같은 이유로 첫 번째에서 안 멈춘다.
 */
export function checkSignalRules(
  ctx: SignalRuleContext,
  t: SignalRuleThresholds,
): RuleBlock[] {
  const blocks: RuleBlock[] = []
  const block = (id: RuleId, reason: string, userMessage: string) =>
    blocks.push({ id, reason, userMessage })

  // SR-01 순기대값 (비용 **포함**, 여기서 또 빼지 않는다 — D-34)
  if (ctx.holdDominant) {
    block('SR-01', 'hold_dominant', '관망이 가장 높습니다')
  } else if (ctx.calibratedProb === null || ctx.netExpectedValueR === null) {
    // 보정이 없으면 못 재는 것이고, 못 재는 것은 통과가 아니다(M3)
    block('SR-01', 'no_calibration_or_ev', '보정 확률이나 기대값이 없어 신호를 낼 수 없습니다')
  } else if (ctx.netExpectedValueR < t.minNetExpectedValueR) {
    block('SR-01', `ev_below_minimum:${ctx.netExpectedValueR.toFixed(4)}<${t.minNetExpectedValueR}`,
      `기대값이 ${ctx.netExpectedValueR.toFixed(3)}R 로 최소값 ${t.minNetExpectedValueR}R 에 못 미칩니다`)
  }

  // SR-02 지금 들어가도 되나
  if (ctx.enterNowProb === null) {
    block('SR-02', 'no_enter_now', '지금 들어가도 되는지에 대한 보정 값이 없습니다')
  } else if (ctx.enterNowProb < t.minEnterNowProb) {
    block('SR-02', `enter_now_below:${ctx.enterNowProb.toFixed(4)}<${t.minEnterNowProb}`,
      '이미 추격 구간이라 지금 들어가면 늦습니다')
  }

  // SR-04 개장 직후·마감 전·교체일·최종거래일
  if (ctx.minutesSinceOpen < t.openingBlockMinutes) {
    block('SR-04', `opening_block:${ctx.minutesSinceOpen}<${t.openingBlockMinutes}`,
      `개장 후 ${t.openingBlockMinutes}분은 새 신호를 내지 않습니다`)
  }
  if (ctx.minutesUntilClose <= t.closingBlockMinutes) {
    block('SR-04', `closing_block:${ctx.minutesUntilClose}<=${t.closingBlockMinutes}`,
      `마감 ${t.closingBlockMinutes}분 전부터는 새 신호를 내지 않습니다`)
  }
  if (ctx.rolloverOrExpiryDay) {
    block('SR-04', 'rollover_or_expiry', '월물 교체일이나 최종거래일에는 새 신호를 내지 않습니다')
  }

  // SR-05 이벤트 전후
  if (ctx.inEventBlackout) {
    block('SR-05', 'event_blackout', '등록된 이벤트 전후라 새 신호를 내지 않습니다')
  }

  // SR-06 오늘 **실현** 손익이 목표에 닿음
  if (ctx.realizedPnlKrw >= t.dailyTargetKrw && t.dailyTargetKrw > 0) {
    block('SR-06', `target_reached:${Math.round(ctx.realizedPnlKrw)}>=${t.dailyTargetKrw}`,
      '오늘 목표를 채웠습니다. 새 신호는 내일부터입니다')
  }

  // SR-07 1회 위험 > 남은 여유
  if (ctx.riskPerTradeKrw > ctx.remainingLossBudgetKrw) {
    block('SR-07',
      `risk_exceeds_budget:${Math.round(ctx.riskPerTradeKrw)}>${Math.round(ctx.remainingLossBudgetKrw)}`,
      `이 신호의 1회 위험이 남은 손실 여유보다 큽니다`)
  }

  // SR-08 연속 손실 쿨다운
  if (ctx.consecutiveLosses >= t.cooldownAfterLosses) {
    const since = ctx.minutesSinceLastLoss
    // 마지막 손실 시각을 모르면 아직 쿨다운 중으로 본다 — 모르는 것을 통과로 치지 않는다
    if (since === null || since < t.cooldownMinutes) {
      block('SR-08', `cooldown:${ctx.consecutiveLosses}losses,since=${since ?? 'unknown'}`,
        `${ctx.consecutiveLosses}연속 손실 뒤 ${t.cooldownMinutes}분 쉽니다`)
    }
  }

  // SR-09 거래일 최대 신호 수
  if (ctx.signalsToday >= t.maxSignalsPerDay) {
    block('SR-09', `max_signals:${ctx.signalsToday}>=${t.maxSignalsPerDay}`,
      `오늘 신호가 ${t.maxSignalsPerDay}건을 채웠습니다`)
  }

  // SR-10 같은 방향 재신호 간격
  if (ctx.minutesSinceSameDirection !== null
    && ctx.minutesSinceSameDirection < t.sameDirectionGapMinutes) {
    block('SR-10', `same_direction_gap:${ctx.minutesSinceSameDirection}<${t.sameDirectionGapMinutes}`,
      `같은 방향 신호는 ${t.sameDirectionGapMinutes}분 간격을 둡니다`)
  }

  /**
   * SR-12 목표 거리 ≥ 왕복 비용 × k.
   *
   * **비용을 뺀 가격 거리**로 잰다. SR-01 이 이미 비용을 뺀 값을 보므로
   * 여기서 또 빼면 같은 비용을 두 번 세게 된다(D-34).
   */
  if (ctx.roundTripCostPoints > 0) {
    const multiple = ctx.targetDistancePoints / ctx.roundTripCostPoints
    if (multiple < t.minTargetCostMultiple) {
      block('SR-12', `target_too_close:${multiple.toFixed(2)}x<${t.minTargetCostMultiple}x`,
        `목표까지의 거리가 왕복 비용의 ${multiple.toFixed(1)}배뿐입니다 `
        + `(${t.minTargetCostMultiple}배 필요)`)
    }
  }

  return blocks
}

export function signalAllowed(blocks: readonly RuleBlock[]): boolean {
  return blocks.length === 0
}
