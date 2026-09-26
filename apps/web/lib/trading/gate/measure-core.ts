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

// ── SG-01 이 볼 둘 (§10.1) ────────────────────────────────

export interface SpreadSample {
  bestBid: number | null
  bestAsk: number | null
}

/**
 * 스프레드 한 줄. 음수거나 숫자가 아니면 **없는 것으로 친다.**
 *
 * 매도호가가 매수호가보다 낮은 값은 우리가 잘못 읽은 것이지 시장이 그런 것이 아니다.
 * 그런 줄을 0 으로 접어 넣으면 중앙값이 내려가고, 내려간 중앙값은 멀쩡한 분을 이상으로 만든다.
 */
export function spreadOf(sample: SpreadSample): number | null {
  const bid = Number.isFinite(sample.bestBid as number) ? (sample.bestBid as number) : null
  const ask = Number.isFinite(sample.bestAsk as number) ? (sample.bestAsk as number) : null
  if (bid === null || ask === null) return null
  const spread = ask - bid
  return spread >= 0 ? spread : null
}

/**
 * 평소 스프레드. 표본이 이만큼은 있어야 「평소」라고 부른다.
 *
 * 평균이 아니라 중앙값이다 — 개장 직후 한 분이 스무 배로 벌어지면 평균은 그쪽으로 끌려가고,
 * 끌려간 평균은 정작 그 다음에 벌어진 분을 정상으로 본다.
 */
export const MIN_SPREAD_SAMPLES = 20

export function medianSpread(samples: readonly SpreadSample[]): number | null {
  const values = samples.map(spreadOf).filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (values.length < MIN_SPREAD_SAMPLES) return null
  const mid = Math.floor(values.length / 2)
  const median = values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
  // 평소가 0 이면 배수로 잴 수 없다. 0 의 세 배도 0 이라 어떤 값이든 이상이 된다
  return median > 0 ? median : null
}

export interface SpreadInput {
  now: SpreadSample
  /** 최근 봉들에서 뽑은 평소 폭. 모르면 null */
  baseline: number | null
  /** 이 배수를 넘으면 이상 */
  multiple: number
}

/**
 * 지금 호가가 평소보다 이상하게 넓은가.
 *
 * **모르면 `null`.** 기준선이 없는 날(수집 첫날, 표본 부족)에 `false` 를 돌려주면
 * 화면에는 「호가 정상」이 뜨는데 실제로는 아무도 안 보고 있다.
 */
export function spreadAbnormalFrom(input: SpreadInput): boolean | null {
  const spread = spreadOf(input.now)
  if (spread === null) return null
  if (input.baseline === null || !(input.baseline > 0)) return null
  if (!Number.isFinite(input.multiple) || input.multiple <= 0) return null
  return spread > input.baseline * input.multiple
}

export interface BarLateInput {
  /** 마지막으로 확정된 판단 봉의 시작 시각. 하나도 없으면 null */
  lastBarStartAt: Date | null
  now: Date
  /** 이만큼 전 봉이 마지막이면 늦은 것으로 본다 */
  lateMinutes: number
}

/**
 * 봉이 빠졌거나 늦었나.
 *
 * 봉이 **하나도 없는** 것은 `false`(정상)가 아니라 `null`(모름)이다 —
 * 수집이 한 번도 안 돈 상태와 방금 돈 상태를 같은 값으로 말하면 둘을 구분할 수 없다.
 */
export function barMissingOrLateFrom(input: BarLateInput): boolean | null {
  if (!input.lastBarStartAt) return null
  const minutes = (input.now.getTime() - input.lastBarStartAt.getTime()) / 60_000
  if (!Number.isFinite(minutes)) return null
  return minutes > input.lateMinutes
}

// ── SG-11 시장 상태 (§10.1) ───────────────────────────────

/**
 * SG-11 이 보는 것들. **하나하나가 따로 모름일 수 있다.**
 *
 * 명세는 서킷브레이커·사이드카·가격제한 근접·거래 정지·동시호가 다섯을 든다.
 * 우리가 지금 볼 수 있는 것은 **동시호가 하나뿐**이다 — 나머지 넷을 주는 창구를
 * 아직 안 붙였다. 다섯을 한 칸으로 접으면 「동시호가 아님」이 「시장 정상」이 되고,
 * 서킷브레이커가 걸린 날 화면이 정상이라고 말한다.
 */
export interface MarketStateInput {
  /** 단일가(동시호가) 구간인가. 세션 창을 모르면 null */
  inAuction: boolean | null
  /** 거래 정지·서킷브레이커·사이드카. 주는 창구가 없어 지금은 언제나 null */
  halted: boolean | null
  /** 가격제한폭에 가까운가. 상·하한가를 주는 창구가 없어 지금은 언제나 null */
  priceLimitNear: boolean | null
}

const MARKET_SIGNALS = ['inAuction', 'halted', 'priceLimitNear'] as const

/**
 * 시장이 평소와 다른가.
 *
 * 아는 것 중 하나라도 참이면 참이다. **전부 모르면 `null`** 이고,
 * 일부만 알면 아는 범위의 답을 돌려주되 모르는 항목은 `unseenMarketSignals` 가 남긴다.
 */
export function marketAbnormalFrom(input: MarketStateInput): boolean | null {
  const known = MARKET_SIGNALS.map((k) => input[k]).filter((v): v is boolean => v !== null)
  if (known.length === 0) return null
  return known.some((v) => v)
}

/** 못 본 항목 이름들. 실행 기록에 실려 「무엇을 안 보고 통과했나」가 남는다 */
export function unseenMarketSignals(input: MarketStateInput): string[] {
  return MARKET_SIGNALS.filter((k) => input[k] === null)
}

/** SG-01 과 SG-11 이 볼 값 셋과, 그중 못 잰 것 */
export interface MarketMeasurement {
  barMissingOrLate: boolean
  spreadAbnormal: boolean
  marketAbnormal: boolean
  unmeasured: string[]
}

/**
 * `null` 을 게이트 꼴로 접는다. 접는 규칙은 foldMeasurement 와 같다.
 *
 * 셋을 **선택 칸으로 두지 않는다** — 안 넘기면 조용히 `false` 가 되고,
 * 그것이 이 파일이 없애려는 바로 그 모양이다.
 */
export function foldMarket(raw: {
  barMissingOrLate: boolean | null
  spreadAbnormal: boolean | null
  marketAbnormal: boolean | null
  /** 시장 신호 중 못 본 항목. 전부 모르면 marketAbnormal 이 null 이라 따로 안 적어도 된다 */
  unseenMarketSignals?: readonly string[]
}): MarketMeasurement {
  const unmeasured: string[] = []
  const known = (name: string, value: boolean | null): boolean => {
    if (value === null) { unmeasured.push(name); return false }
    return value
  }
  const result = {
    barMissingOrLate: known('barMissingOrLate', raw.barMissingOrLate),
    spreadAbnormal: known('spreadAbnormal', raw.spreadAbnormal),
    marketAbnormal: known('marketAbnormal', raw.marketAbnormal),
    unmeasured,
  }
  // 일부만 본 경우에도 무엇을 안 봤는지 남긴다. 전부 모르면 위에서 이미 남았다
  if (raw.marketAbnormal !== null) unmeasured.push(...(raw.unseenMarketSignals ?? []))
  return result
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
export function measurementNote(m: GateMeasurement, market?: MarketMeasurement): string {
  const parts = [
    `broker_fail=${m.brokerFailureStreak}`,
    `since_run=${m.minutesSinceLastRun ?? 'unknown'}`,
    `calib=${m.hasCalibration}`,
    `spec=${m.hasActiveSpec}`,
    `margin_tight=${m.marginTight}`,
    `ai_budget_out=${m.aiBudgetExhausted}`,
  ]
  if (market) {
    parts.push(
      `bar_late=${market.barMissingOrLate}`,
      `spread_wide=${market.spreadAbnormal}`,
      `market_abnormal=${market.marketAbnormal}`,
    )
  }
  const unmeasured = [...m.unmeasured, ...(market?.unmeasured ?? [])]
  if (unmeasured.length > 0) parts.push(`unmeasured=${unmeasured.join('+')}`)
  return `gate(${parts.join(',')})`
}
