/**
 * 체결 줄을 표에 넣을 꼴로 — **순수 계산**
 *
 * ## 체결 시각을 지어내지 않는다
 *
 * KIS 주문체결내역에는 체결 시각이 없다. 있는 시각은 `ord_tmd`(주문시각) 하나다.
 * 그래서 하한(주문 시각)과 상한(우리가 처음 본 시각)만 적고 `filledAt` 은 null 로 둔다.
 * 주문 시각을 체결 시각 자리에 넣으면 체결 지연이 언제나 0 이 되는데,
 * 0 은 화면에서 「모른다」가 아니라 「빨랐다」로 읽힌다.
 *
 * ## 체결 순번도 없다
 *
 * 1계약이라 부분 체결이 없어(D-13) 한 주문에 체결이 하나다. `fillSeq` 는 한 값만 쓴다.
 */

import { openQuantity, type Fill } from '../broker/account-request.ts'

/** 부분 체결이 없으니 순번은 한 값이다. 2계약 이상을 허용하는 날 여기부터 본다 */
export const SINGLE_FILL_SEQ = '0'

export interface FillRow {
  orderNo: string
  fillSeq: string
  contractCode: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  orderAt: string | null
  /** KIS 가 안 준다. 받는 날 채운다 */
  filledAt: null
  feeKrw: number | null
}

/**
 * `20260926` + `093015` → ISO. KIS 는 한국 시각으로 준다.
 *
 * 둘 중 하나라도 꼴이 아니면 null — **없는 시각을 만들지 않는다.**
 * `ord_tmd` 가 `0930` 처럼 짧게 오는 판도 있어 초는 없으면 0 으로 본다.
 */
export function seoulStampToIso(date: string, time: string): string | null {
  if (!/^\d{8}$/.test(date)) return null
  const t = time.padEnd(6, '0')
  if (!/^\d{6}$/.test(t)) return null
  const hh = Number(t.slice(0, 2)), mm = Number(t.slice(2, 4)), ss = Number(t.slice(4, 6))
  if (hh > 23 || mm > 59 || ss > 59) return null
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    + `T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+09:00`
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/**
 * 체결 줄만 남긴다.
 *
 * **채워진 수량이 0 이면 체결이 아니다.** 미체결과 거부도 같은 창구로 오고,
 * 그것을 체결로 세면 없는 포지션이 생긴다. 표의 `quantity > 0` 제약에도 걸린다.
 *
 * 방향을 못 읽은 줄도 버린다 — 사고 판 것을 모르면 포지션을 세울 수 없고,
 * 한쪽으로 찍으면 그 순간 기록이 거짓이 된다.
 */
export function toFillRows(fills: readonly Fill[]): FillRow[] {
  const out: FillRow[] = []
  for (const fill of fills) {
    if (fill.filledQty <= 0) continue
    if (fill.direction === null) continue
    if (fill.avgPrice === null || !Number.isFinite(fill.avgPrice)) continue
    if (!fill.contractCode) continue
    out.push({
      orderNo: fill.orderNo,
      fillSeq: SINGLE_FILL_SEQ,
      contractCode: fill.contractCode,
      // `long` 은 산 것, `short` 는 판 것. 표는 buy/sell 로 적는다
      side: fill.direction === 'long' ? 'buy' : 'sell',
      quantity: fill.filledQty,
      price: fill.avgPrice,
      orderAt: seoulStampToIso(fill.orderDate, fill.orderTime),
      filledAt: null,
      feeKrw: fill.feeKrw,
    })
  }
  return out
}

/** 아직 안 채워진 주문의 주문번호들. 「나갔는지 모르는 주문」을 푸는 데 쓴다 */
export function openOrderNosOf(fills: readonly Fill[]): string[] {
  return fills.filter((f) => openQuantity(f) > 0).map((f) => f.orderNo)
}
