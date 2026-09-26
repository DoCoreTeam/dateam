/**
 * 리스크 산술 — **금액은 데이터로 계산하고 코드에 안 적는다** (명세 §9 · M6)
 *
 * ## 왜 「최악 진입가」로 재나
 *
 * 사람이 알림을 보고 주문하기까지 1~3분이 걸린다. 그 사이 가격은 움직이고,
 * 우리는 진입 한계가까지는 따라가도 좋다고 정해 뒀다(§8). 그러면 **실제로 질 수 있는 손실은
 * 기준가가 아니라 그 한계가에서 손절까지**다. 기준가로 재면 위험을 늘 작게 본다.
 *
 * ## 방향이 계산에 들어간다 (D-31)
 *
 * 롱의 한계가는 기준가보다 **위**, 숏은 **아래**다. 숏에서 「최대 진입가」라고 쓰면
 * 위쪽 값을 집어 손절까지의 거리가 짧게 나오고, 위험이 작다고 계산한다 —
 * 그 버그는 화면에서 아무 일도 안 일어나고 실제 손실에서만 드러난다.
 *
 * ## 왜 「하루 손절 N회」가 아니라 남은 여유인가 (D-12)
 *
 * 1회 위험이 ATR 에 비례해 신호마다 다르다. 횟수로 세면 변동성이 큰 날 세 번만에
 * 한도를 넘고, 작은 날은 열 번을 해도 안 찬다. 그래서 금액으로 센다.
 */

export type Direction = 'long' | 'short'

/** 상품 규격. `trading_instruments` 에서 온다 — 여기 숫자를 적지 않는다 */
export interface InstrumentSpec {
  /** 1포인트가 몇 원인가 */
  multiplier: number
  /** 최소 호가 간격(포인트) */
  tickSize: number
}

export interface RiskInput {
  direction: Direction
  instrument: InstrumentSpec
  /** 신호가 난 시점의 기준 가격 */
  referencePrice: number
  /** 손절가 (§8: 기준가 ∓ 1.2 × ATR) */
  stopPrice: number
  /** 진입 한계 거리(포인트). 롱은 위로, 숏은 아래로 이만큼까지 따라간다 */
  chaseDistance: number
  /** 손절이 밀리는 틱 수 */
  stopSlippageTicks: number
  /** 왕복 수수료(원). 계좌 수수료로 계산한다 */
  roundTripFeeKrw: number
  /** 계약 수. Release 1 은 1 */
  quantity: number
}

export interface RiskResult {
  /** 사람이 늦게 들어가도 여기까지는 허용하는 가격 */
  worstEntryPrice: number
  /** 가격만으로 지는 손실(원) */
  priceRiskKrw: number
  /** 가격 위험 + 왕복 비용 */
  riskPerTradeKrw: number
  /** 최악 진입가에서 손절까지의 거리(포인트, 슬리피지 포함) */
  stopDistancePoints: number
}

/**
 * 진입 한계가 — **방향이 부호를 정한다.**
 *
 * 롱은 기준가 + 거리(위로 따라간다), 숏은 기준가 − 거리(아래로 따라간다).
 */
export function worstEntryPrice(
  direction: Direction,
  referencePrice: number,
  chaseDistance: number,
): number {
  return direction === 'long'
    ? referencePrice + chaseDistance
    : referencePrice - chaseDistance
}

/**
 * 원 단위로 맞춘다.
 *
 * 포인트를 부동소수로 곱하면 100,000 원이 100,000.0000000018 원이 된다.
 * 그 값으로 「위험 ≤ 남은 여유」를 비교하면 **같은 금액인데 넘었다고 나오는** 날이 온다.
 * 돈은 원 단위가 실제 단위다 — 그보다 잘게 들고 있을 이유가 없다.
 */
function toWon(value: number): number {
  return Math.round(value)
}

/** 포인트는 호가 단위보다 잘게 볼 이유가 없다. 8자리에서 끊어 오차만 없앤다 */
function toPoints(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

export function computeRisk(input: RiskInput): RiskResult {
  const worst = worstEntryPrice(input.direction, input.referencePrice, input.chaseDistance)

  /**
   * 절댓값을 쓴다. 방향은 이미 `worst` 에 들어갔고, 여기서 또 부호를 따지면
   * 롱과 숏 중 한쪽만 맞는 식이 된다.
   */
  const stopDistancePoints = toPoints(
    Math.abs(worst - input.stopPrice) + input.stopSlippageTicks * input.instrument.tickSize,
  )

  const priceRiskKrw = toWon(stopDistancePoints * input.instrument.multiplier * input.quantity)
  return {
    worstEntryPrice: toPoints(worst),
    priceRiskKrw,
    riskPerTradeKrw: priceRiskKrw + toWon(input.roundTripFeeKrw),
    stopDistancePoints,
  }
}

export interface BudgetInput {
  /** 설정 `daily_loss_limit_krw` */
  dailyLossLimitKrw: number
  /** 오늘 **실현** 손실(양수). 체결 기준이다 */
  realizedLossKrw: number
  /** 열린 포지션이 지금 손절되면 더 질 손실 */
  openPositionRiskKrw: number
}

/** 남은 손실 여유 = 한도 − 오늘 실현 손실 − 열린 포지션의 남은 위험 */
export function remainingLossBudget(input: BudgetInput): number {
  return input.dailyLossLimitKrw - input.realizedLossKrw - input.openPositionRiskKrw
}

export type RiskRejection = { reason: string; userMessage: string }


/**
 * 이 설정을 **저장해도 되나** (M6).
 *
 * 일일 손실 한도가 이 상품·손절 설정에서 예상되는 1회 위험보다 작으면 저장하지 않는다.
 * 저장하면 그 설정으로는 **어떤 신호도 못 내는** 상태가 되는데, 화면에는
 * 「신호가 안 온다」로만 보인다 — 왜 안 오는지는 아무 데도 안 적힌다.
 */
export function checkSettingsStorable(input: {
  dailyLossLimitKrw: number
  typicalRisk: RiskResult
}): RiskRejection | null {
  if (input.dailyLossLimitKrw < input.typicalRisk.riskPerTradeKrw) {
    return {
      reason: `limit_below_single_risk:${Math.round(input.dailyLossLimitKrw)}<${Math.round(input.typicalRisk.riskPerTradeKrw)}`,
      userMessage: `일일 손실 한도(${Math.round(input.dailyLossLimitKrw).toLocaleString('ko-KR')}원)가 `
        + `이 상품의 1회 위험(${Math.round(input.typicalRisk.riskPerTradeKrw).toLocaleString('ko-KR')}원)보다 작아 `
        + `어떤 신호도 나가지 못합니다`,
    }
  }
  return null
}

/** 순손익을 R 로. 1R = 1회 위험. 상품이 달라도 같은 자로 비교하려고 쓴다 */
export function toR(netPnlKrw: number, riskPerTradeKrw: number): number | null {
  if (!(riskPerTradeKrw > 0)) return null
  return netPnlKrw / riskPerTradeKrw
}
