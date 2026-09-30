/**
 * 내가 들어갔다고 적는 자리 — **증권사 기록이 아니다**
 *
 * 사용자 지시 2026-09-30: 「지금 관점으로 들어가야 하고 들어갔으면 체크하게 해줘
 * 얼마에 들어갔는지 확인하고 말이야」.
 *
 * `trading_fills` 는 증권사가 준 체결이고 매분 도는 수집이 그 표와 계좌를 대조한다.
 * 거기에 사람이 손으로 적은 줄을 섞으면 대조가 늘 어긋나고, 늘 어긋나는 경보는 안 읽힌다.
 * 그래서 표를 따로 두고(마이그 295), 화면도 **내가 적은 기록**이라고 말한다.
 *
 * 값 검증은 **서버에서 한다.** 화면이 막아도 창구는 열려 있고, 창구가 받은 값이
 * 그대로 표에 들어간다(S4).
 */

import { fmtNum } from '../../ui/number-format.ts'
import { formatIndexPrice } from '../signal-labels.ts'

/** 이 자리가 쓰는 말 */
export const MANUAL_ENTRY_LABEL = {
  title: '내가 들어간 것',
  /** 이것이 무엇인지 — 증권사 체결과 섞이면 안 된다 */
  note: '내가 적는 기록입니다. 증권사 체결이 아니고 주문도 안 나갑니다',
  enter: '들어갔습니다',
  exit: '나왔습니다',
  none: '아직 들어간 것이 없습니다',
  entryPrice: '얼마에 들어갔나',
  exitPrice: '나온 가격',
  quantity: '계약 수',
  buy: '샀습니다 (롱)',
  sell: '팔았습니다 (숏)',
  nowPrice: '지금 가격',
  pnl: '지금 손익',
  stop: '틀리면 여기서',
  target: '벌면 여기서',
  since: '들어간 때',
  /** 되돌리는 법. 지운 뒤에 찾게 하지 않는다 */
  undo: '잘못 적었으면 「나왔습니다」로 닫고 다시 적으면 됩니다',
} as const

export type Direction = 'long' | 'short'

export interface EntryInput {
  direction: string
  price: number
  quantity: number
}

export type EntryCheck =
  | { ok: true; value: { direction: Direction; price: number; quantity: number } }
  | { ok: false; reason: string }

/**
 * 적어도 되는 값인가. **밖에서 온 값이라 서버가 다시 본다**(S4).
 *
 * 0 이나 음수를 막는 이유: 가격 0 은 「공짜로 샀다」가 되고 그 뒤 손익이 전부 거짓이 된다.
 */
export function checkEntry(input: EntryInput): EntryCheck {
  if (input.direction !== 'long' && input.direction !== 'short') {
    return { ok: false, reason: '방향은 롱이나 숏이어야 합니다' }
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { ok: false, reason: '들어간 가격을 숫자로 적어 주세요' }
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, reason: '계약 수는 1 이상 정수여야 합니다' }
  }
  // 소수 둘까지가 화면이 그리는 자릿수다. 그보다 길면 화면과 기록이 다른 값을 말한다
  return {
    ok: true,
    value: {
      direction: input.direction,
      price: Math.round(input.price * 100) / 100,
      quantity: input.quantity,
    },
  }
}

export interface ManualPnl {
  /** 몇 점 벌었나(잃었나). 롱은 오르면 +, 숏은 내리면 + */
  points: number
  /** 얼마인가(원). 승수를 모르면 null — 0원으로 때우지 않는다 */
  won: number | null
  /** 한 줄로 */
  text: string
}

/**
 * 지금 얼마인가.
 *
 * **숏은 부호가 뒤집힌다** — 팔아 둔 것이라 가격이 내려야 번다.
 * 이것을 안 뒤집으면 화면이 손실을 이익으로 그린다.
 */
export function manualPnl(input: {
  direction: Direction
  entryPrice: number
  nowPrice: number | null
  quantity: number
  multiplier: number | null
}): ManualPnl | null {
  const { direction, entryPrice, nowPrice, quantity, multiplier } = input
  if (nowPrice === null || !Number.isFinite(nowPrice) || !Number.isFinite(entryPrice)) return null

  const round2 = (v: number): number => Math.round(v * 100) / 100
  const moved = round2(nowPrice) - round2(entryPrice)
  const points = Math.round((direction === 'long' ? moved : -moved) * 100) / 100

  const hasMultiplier = multiplier !== null && Number.isFinite(multiplier) && multiplier > 0
  const won = hasMultiplier ? Math.round(points * multiplier * quantity) : null
  const sign = points > 0 ? '+' : ''
  return {
    points,
    won,
    text: won === null
      ? `${sign}${fmtNum(points, 2)}점`
      : `${sign}${won.toLocaleString('ko-KR')}원`,
  }
}

/** 들어간 값과 지금 값을 나란히 — 한 줄로 읽히게 */
export function entryLine(direction: Direction, entryPrice: number, quantity: number): string {
  const what = direction === 'long' ? '샀습니다' : '팔았습니다'
  const many = quantity > 1 ? ` ${quantity}계약` : ''
  return `${formatIndexPrice(entryPrice)} 에${many} ${what}`
}
