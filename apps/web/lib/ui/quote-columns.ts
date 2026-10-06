/**
 * 견적서 표의 **열 폭을 정하는 한 곳.**
 *
 * ## 왜 따로 있나
 *
 * 폭은 비율이고 **합은 늘 100 이어야 한다.** 모자라거나 남으면 브라우저가 제 마음대로
 * 나눠 화면과 종이의 배치가 달라진다. 그런데 비율을 화면 파일 안에서 삼항 연산자로
 * 엮어 두면 경우가 늘 때마다 합이 맞는지 **사람이 암산해야 한다** — 그러다 틀리면
 * 틀린 줄도 모른다. 여기로 꺼내 두면 시험이 여덟 경우의 합을 기계로 센다.
 *
 * ## 무엇이 폭을 바꾸나
 *
 * 세 가지다. 할인 열이 서느냐, 비고 열이 서느냐, 그리고 **비고가 기냐**.
 * 셋째가 이번에 는 것이다 — 비고 열은 「64코어」 같은 짧은 말을 담으려고 10% 로
 * 잡았는데, 영문 한 문장이 들어오자 낱말 가운데서 끊겼다
 * (실측 2026-10-05: 「providin/g the special discoun/t for this two months rent.」).
 */

/** 금액 열. **실측으로 정한 값이라 건드리지 않는다** — 줄였을 때 「330,000,000원」의 「원」이 잘렸다 */
const AMOUNT = 25

/** 할인 열. 두 비율과 화살표가 한 줄에 서야 한다 — 8% 였을 때 「30% → 100%」가 접혔다 */
const DISCOUNT = 16

/** 번호 열 */
const NO = 5

/**
 * 비고가 이 글자 수를 넘으면 긴 것으로 본다.
 *
 * 10% 열은 1,280px 짜리 표에서 55px 남짓이다. 그 폭에 들어가는 한글은 네댓 자,
 * 영문은 한 낱말이 겨우다. 스물네 자를 넘으면 어느 쪽이든 여러 줄이 되므로
 * 그때부터는 폭을 더 주는 편이 낫다.
 */
export const REMARK_LONG_CHARS = 24

export function hasLongRemark(lines: readonly { remark?: string | null }[]): boolean {
  return lines.some((l) => (l.remark ?? '').trim().length > REMARK_LONG_CHARS)
}

export interface QuoteColumnShape {
  /** 할인 열이 서나 */
  showDiscount: boolean
  /** 비고 열이 서나 */
  showRemark: boolean
  /** 비고가 길어 폭을 더 줘야 하나. 비고 열이 안 서면 뜻이 없다 */
  longRemark?: boolean
}

/** 퍼센트 숫자. 화면은 여기에 `%` 를 붙여 쓴다 */
export interface QuoteColumnWidths {
  no: number
  name: number
  unit: number
  quantity: number
  unitPrice: number
  discount: number
  amount: number
  remark: number
}

/**
 * 열 폭을 정한다. **합은 늘 100 이다**(`quote-columns.test.ts` 가 여덟 경우를 다 센다).
 *
 * 넓힌 비고 폭은 **단가에서 3, 품목 이름에서 2** 를 떼어 온다.
 * 단가는 「1,388원」 정도라 15% 가 늘 남았고, 이름은 가장 넓은 열이라 2% 를 줄여도
 * 줄 수가 안 는다(실측 2026-10-05, 1,440·1,280 둘 다에서 확인).
 * 금액과 할인은 위에 적은 이유로 안 건드린다.
 */
export function quoteColumnWidths(shape: QuoteColumnShape): QuoteColumnWidths {
  const { showDiscount, showRemark } = shape
  const long = showRemark && shape.longRemark === true
  const discount = showDiscount ? DISCOUNT : 0
  const remark = showRemark ? (long ? 15 : 10) : 0
  const unitPrice = long ? 12 : 15
  const unit = showRemark ? 6 : 7
  const quantity = showRemark ? 5 : 6
  const name = 100 - NO - unit - quantity - unitPrice - discount - AMOUNT - remark
  return {
    no: NO, name, unit, quantity, unitPrice, discount, amount: AMOUNT, remark,
  }
}

/** `18%` 꼴로 — 화면이 `style={{ width }}` 에 그대로 넣는다 */
export function pct(n: number): string {
  return `${n}%`
}
