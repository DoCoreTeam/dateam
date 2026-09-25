/**
 * 체결 재현 — **「사람이 따라 했다면」을 1분 봉으로 계산한다** (명세 §13.2)
 *
 * ## 왜 신호 시점 가격으로 안 재나
 *
 * 신호가 난 가격으로 재면 **사람이 없는 세계의 성적**이 나온다. 실제로는 알림을 보고
 * 주문하기까지 1~3분이 걸리고(C3), 그 사이 가격이 움직이며, 넘어서면 우리는 안 따라간다.
 * 그 셋을 빼고 남는 것이 진짜 기대값이다 — 그것이 이 파일의 전부다.
 *
 * ## 한 봉 안에서 손절과 목표가 모두 닿으면
 *
 * 1분 봉은 고가와 저가만 알려 주고 **순서는 안 알려 준다.** 그래서 어느 쪽이 먼저인지
 * 알 수 없다. 이때 **불리한 쪽(손절)** 으로 센다 — 유리한 쪽을 고르면 백테스트만
 * 잘 나오고 실전에서 그만큼 빠진다. 그런 봉의 비율을 함께 돌려주고,
 * 비율이 높으면 그 성적 자체를 의심해야 한다(기본 5%).
 *
 * ## 미래를 안 본다 (M5)
 *
 * 진입 이후의 봉만 순서대로 훑는다. 「나중에 어디까지 갔나」를 먼저 보고 청산을 정하지 않는다.
 */

import type { MinuteBarInput } from '../bars/confirm.ts'
import type { Direction } from '../risk/arithmetic.ts'

export type OrderKind = 'market' | 'limit'

export interface ExitPlan {
  /** 손절가 */
  stopPrice: number
  /** 목표가 (하나다, §8) */
  targetPrice: number
  /** 진입 한계가 — 넘어서면 안 따라간다 */
  chaseLimitPrice: number
  /** 진입 후 이 분이 지나면 청산 */
  timeExitMinutes: number
  /** 당일 청산 시각 */
  sessionCloseAt: Date
}

export interface ReplayParams {
  direction: Direction
  /** 신호가 난 봉의 종가 */
  signalPrice: number
  /** 신호가 난 봉의 마감 시각 */
  signalAt: Date
  plan: ExitPlan
  /** 신호 → 주문까지 지연(분). 크론 지연도 여기 포함(§13.2) */
  delayMinutes: number
  orderKind: OrderKind
  /** 진입·청산에 얹는 슬리피지(포인트, 편도) */
  slippagePoints: number
  /** 손절이 밀리는 슬리피지(포인트, 편도) */
  stopSlippagePoints: number
  /** 승수 × 수량 */
  contractValue: number
  /** 왕복 수수료(원) */
  roundTripFeeKrw: number
}

export type ExitKind = 'target' | 'stop' | 'time' | 'session_close' | 'not_filled'

export interface ReplayResult {
  filled: boolean
  entryPrice: number | null
  entryAt: Date | null
  exitPrice: number | null
  exitAt: Date | null
  exitKind: ExitKind
  /** 비용 포함 순손익(원) */
  netPnlKrw: number
  costKrw: number
  /** 한 봉 안에서 손절·목표가 모두 닿아 불리한 쪽으로 셌나 */
  ambiguousBar: boolean
  /** 왜 이 결과인가. 조용히 0원을 돌려주지 않는다 */
  reason: string
}

const MINUTE_MS = 60_000

/** 롱은 크면 좋고 숏은 작으면 좋다. 방향을 한 자리에서만 따진다 */
function favors(direction: Direction, price: number, reference: number): boolean {
  return direction === 'long' ? price >= reference : price <= reference
}

/** 진입 한계를 넘어섰나 — 롱은 위쪽, 숏은 아래쪽 */
function beyondChaseLimit(direction: Direction, price: number, limit: number): boolean {
  return direction === 'long' ? price > limit : price < limit
}

/** 지연 후 첫 봉. 없으면 null — 장이 끝났거나 데이터가 없다 */
function barAfterDelay(
  bars: readonly MinuteBarInput[],
  signalAt: Date,
  delayMinutes: number,
): MinuteBarInput | null {
  const wanted = signalAt.getTime() + delayMinutes * MINUTE_MS
  for (const bar of bars) {
    if (bar.startAt.getTime() >= wanted) return bar
  }
  return null
}

/**
 * 사람이 따라 했다면 어떻게 됐나.
 *
 * @param bars 신호 봉 **이후**의 1분 봉들, 오래된 것부터. 미래를 안 보려면 이 순서가 전부다
 */
export function replayExecution(
  params: ReplayParams,
  bars: readonly MinuteBarInput[],
): ReplayResult {
  const { direction, plan } = params
  const notFilled = (reason: string): ReplayResult => ({
    filled: false, entryPrice: null, entryAt: null, exitPrice: null, exitAt: null,
    exitKind: 'not_filled', netPnlKrw: 0, costKrw: 0, ambiguousBar: false, reason,
  })

  const entryBar = barAfterDelay(bars, params.signalAt, params.delayMinutes)
  if (!entryBar) return notFilled('no_bar_after_delay')

  /**
   * 지연 후 가격. 1분 봉만 있으므로 그 봉의 **시가**를 쓴다 —
   * 종가를 쓰면 그 1분 동안의 움직임을 미리 안 것이 된다.
   */
  const priceAfterDelay = entryBar.open

  // 진입 한계를 넘었으면 안 따라간다 (§8)
  if (beyondChaseLimit(direction, priceAfterDelay, plan.chaseLimitPrice)) {
    return notFilled('beyond_chase_limit')
  }

  let entryPrice: number
  if (params.orderKind === 'market') {
    // 시장가는 불리한 쪽으로 밀린다
    entryPrice = direction === 'long'
      ? priceAfterDelay + params.slippagePoints
      : priceAfterDelay - params.slippagePoints
  } else {
    /**
     * 지정가는 **가격이 신호가로 돌아온 경우만** 체결된다.
     * 롱이면 그 봉의 저가가 신호가 이하로 내려와야 하고, 숏이면 고가가 올라와야 한다.
     */
    const touched = direction === 'long'
      ? entryBar.low <= params.signalPrice
      : entryBar.high >= params.signalPrice
    if (!touched) return notFilled('limit_not_touched')
    entryPrice = params.signalPrice
  }

  // 진입 한계는 체결가에도 적용한다 — 슬리피지로 넘어서면 그것도 안 따라간 것이다
  if (beyondChaseLimit(direction, entryPrice, plan.chaseLimitPrice)) {
    return notFilled('slipped_beyond_chase_limit')
  }

  const entryAt = entryBar.startAt
  const timeExitAt = new Date(entryAt.getTime() + plan.timeExitMinutes * MINUTE_MS)
  let ambiguousBar = false

  /** 진입한 봉 **다음**부터 본다. 같은 봉 안의 순서를 알 수 없기 때문이다 */
  const after = bars.filter((b) => b.startAt.getTime() > entryAt.getTime())

  for (const bar of after) {
    const hitTarget = favors(direction, direction === 'long' ? bar.high : bar.low, plan.targetPrice)
    const hitStop = direction === 'long' ? bar.low <= plan.stopPrice : bar.high >= plan.stopPrice

    if (hitTarget && hitStop) {
      /**
       * 둘 다 닿았다. 순서를 모르므로 **불리한 쪽**으로 센다.
       * 유리한 쪽을 고르면 백테스트만 잘 나오고 실전에서 그만큼 빠진다.
       */
      ambiguousBar = true
      return settle(params, entryPrice, entryAt, stopFill(params, plan), bar.startAt, 'stop', true,
        'both_touched_same_bar')
    }
    if (hitStop) {
      return settle(params, entryPrice, entryAt, stopFill(params, plan), bar.startAt, 'stop', false, 'stop')
    }
    if (hitTarget) {
      // 목표가는 지정가로 걸어 두므로 슬리피지가 없다
      return settle(params, entryPrice, entryAt, plan.targetPrice, bar.startAt, 'target', false, 'target')
    }
    if (bar.startAt.getTime() >= plan.sessionCloseAt.getTime()) {
      return settle(params, entryPrice, entryAt, exitAtMarket(params, bar.open), bar.startAt,
        'session_close', ambiguousBar, 'session_close')
    }
    if (bar.startAt.getTime() >= timeExitAt.getTime()) {
      return settle(params, entryPrice, entryAt, exitAtMarket(params, bar.open), bar.startAt,
        'time', ambiguousBar, 'time_exit')
    }
  }

  /**
   * 봉이 떨어졌다. **0원으로 때우지 않는다** — 마지막 봉 종가로 청산한 것으로 보고
   * 그 사실을 사유에 남긴다. 구간 끝에 걸린 거래를 조용히 버리면 성적이 좋아진다.
   */
  const last = after[after.length - 1]
  if (!last) return notFilled('no_bar_after_entry')
  return settle(params, entryPrice, entryAt, exitAtMarket(params, last.close), last.startAt,
    'session_close', ambiguousBar, 'ran_out_of_bars')
}

/** 손절 체결가 — 손절가에서 불리한 쪽으로 더 밀린다 */
function stopFill(params: ReplayParams, plan: ExitPlan): number {
  return params.direction === 'long'
    ? plan.stopPrice - params.stopSlippagePoints
    : plan.stopPrice + params.stopSlippagePoints
}

/** 시장가 청산 — 불리한 쪽으로 밀린다 */
function exitAtMarket(params: ReplayParams, price: number): number {
  return params.direction === 'long'
    ? price - params.slippagePoints
    : price + params.slippagePoints
}

function settle(
  params: ReplayParams,
  entryPrice: number,
  entryAt: Date,
  exitPrice: number,
  exitAt: Date,
  exitKind: ExitKind,
  ambiguousBar: boolean,
  reason: string,
): ReplayResult {
  const movePoints = params.direction === 'long'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice
  const grossKrw = movePoints * params.contractValue
  const costKrw = params.roundTripFeeKrw
  return {
    filled: true,
    entryPrice: round2(entryPrice),
    entryAt,
    exitPrice: round2(exitPrice),
    exitAt,
    exitKind,
    // 돈은 원 단위다. 포인트를 부동소수로 곱한 먼지를 들고 다니지 않는다
    netPnlKrw: Math.round(grossKrw - costKrw),
    costKrw: Math.round(costKrw),
    ambiguousBar,
    reason,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 여러 거래에서 애매한 봉의 비율. 기준(기본 5%)을 넘으면 결과에 경고를 붙인다 */
export function ambiguousRatio(results: readonly ReplayResult[]): number {
  const filled = results.filter((r) => r.filled)
  if (filled.length === 0) return 0
  return filled.filter((r) => r.ambiguousBar).length / filled.length
}
