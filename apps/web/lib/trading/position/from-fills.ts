/**
 * 체결을 접어 포지션과 닫힌 거래를 낸다 — **순수 계산**
 *
 * ## 왜 접어야 하나
 *
 * 계좌 잔고 조회는 「지금 들고 있는 것」만 답한다. 아침에 들어갔다 점심에 나왔으면
 * 오후의 잔고는 비어 있고, 그 왕복이 얼마였는지는 어디에도 없다.
 * 실현 손익도 일일 손실 한도도 그 왕복을 알아야 잴 수 있다.
 *
 * ## 짝짓는 규칙
 *
 * 체결을 시각 순으로 훑으며 **부호 있는 수량**을 더한다. 산 것은 +, 판 것은 -.
 * 부호가 바뀌거나 0 이 되는 순간 그 앞의 것이 닫힌다. 남는 것이 지금 포지션이다.
 *
 * 뒤집기(+1 에서 -1 로 한 번에)도 이 규칙으로 갈라진다 — 1계약을 닫고 1계약을 새로 연다.
 * 1계약만 쓰는 지금은 안 나오지만, 규칙이 수량을 세지 않으면 2계약을 허용하는 날
 * 조용히 틀린 손익이 나온다.
 *
 * ## 수수료는 왕복이다
 *
 * `RealizedTrade.feeKrw` 는 **들어갈 때와 나올 때를 합한 값**이다.
 * 한쪽만 넣으면 손익이 수수료 한 번치만큼 좋게 나온다.
 */

import type { Direction, InstrumentSpec } from '../risk/arithmetic.ts'
import type { RealizedTrade } from './pnl.ts'

export interface FillLike {
  side: 'buy' | 'sell'
  quantity: number
  price: number
  /** 접는 순서. 이미 정렬돼 들어온다고 보지 않고 여기서 다시 세운다 */
  at: string
  feeKrw: number | null
  signalId: string | null
}

export interface OpenPosition {
  direction: Direction
  quantity: number
  avgPrice: number
  /** 이 포지션을 연 마지막 체결의 시각 */
  openedAt: string
  /** 이 포지션을 연 체결에 달린 신호. 없으면 사람이 손으로 한 거래 */
  signalId: string | null
}

export interface FoldResult {
  /** 지금 들고 있는 것. 사고 판 것이 같으면 null(=flat) */
  open: OpenPosition | null
  /** 닫힌 왕복들. `dayPnl` 이 바로 먹는다 */
  closed: RealizedTrade[]
}

/** 한 조각. 아직 안 닫힌 진입 한 계약 */
interface Leg {
  direction: Direction
  price: number
  at: string
  /** 이 계약 한 장이 진 진입 수수료 */
  feePerUnit: number
  signalId: string | null
}

function signedOf(side: 'buy' | 'sell'): Direction {
  return side === 'buy' ? 'long' : 'short'
}

/** 한 장당 수수료. 수수료를 안 주면 0 으로 본다 — 없는 비용을 지어내지 않는다 */
function feePerUnit(fill: FillLike): number {
  if (fill.feeKrw === null || !Number.isFinite(fill.feeKrw)) return 0
  if (fill.quantity <= 0) return 0
  return fill.feeKrw / fill.quantity
}

/**
 * 체결을 접는다.
 *
 * 들어온 순서를 믿지 않고 `at` 으로 다시 세운다 — 조회가 역순(`SORT_SQN: 'DS'`)으로 오고,
 * 역순으로 접으면 판 것이 먼저 와서 없는 포지션을 닫으려 든다.
 */
export function foldFills(
  fills: readonly FillLike[], instrument: InstrumentSpec,
): FoldResult {
  const ordered = [...fills].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const legs: Leg[] = []
  const closed: RealizedTrade[] = []

  for (const fill of ordered) {
    if (fill.quantity <= 0 || !Number.isFinite(fill.price)) continue
    const incoming = signedOf(fill.side)
    const unitFee = feePerUnit(fill)
    let remaining = fill.quantity

    // ① 반대 방향이면 먼저 닫는다. 먼저 연 것부터 닫는다(선입선출)
    while (remaining > 0 && legs.length > 0 && legs[0].direction !== incoming) {
      const leg = legs.shift() as Leg
      closed.push({
        direction: leg.direction,
        entryPrice: leg.price,
        exitPrice: fill.price,
        quantity: 1,
        instrument,
        // 왕복이다 — 들어갈 때 한 장치 + 나올 때 한 장치
        feeKrw: leg.feePerUnit + unitFee,
      })
      remaining -= 1
    }

    // ② 남은 것은 새로 연다. 뒤집기면 여기로 넘어온다
    for (let i = 0; i < remaining; i += 1) {
      legs.push({
        direction: incoming, price: fill.price, at: fill.at,
        feePerUnit: unitFee, signalId: fill.signalId,
      })
    }
  }

  return { open: openOf(legs), closed }
}

/** 남은 조각들을 포지션 하나로. 전부 같은 방향이다 — 반대가 있으면 ①에서 닫혔다 */
function openOf(legs: readonly Leg[]): OpenPosition | null {
  if (legs.length === 0) return null
  const total = legs.reduce((sum, leg) => sum + leg.price, 0)
  const last = legs[legs.length - 1]
  return {
    direction: legs[0].direction,
    quantity: legs.length,
    avgPrice: total / legs.length,
    openedAt: last.at,
    // 신호는 **먼저 연 것**의 것이다. 이 포지션이 시작된 이유이기 때문
    signalId: legs[0].signalId,
  }
}

/**
 * 감시가 볼 「우리 기록의 포지션」 꼴로.
 *
 * 계좌 대조가 이것과 잔고를 견준다. **비어 있으면 대조가 언제나 어긋난다** —
 * 계좌에만 있다고 나오기 때문이고, 그것이 이 판 전까지의 상태였다.
 */
export function expectedFrom(
  contractCode: string, open: OpenPosition | null,
): { contractCode: string; direction: Direction; quantity: number }[] {
  if (!open) return []
  return [{ contractCode, direction: open.direction, quantity: open.quantity }]
}
