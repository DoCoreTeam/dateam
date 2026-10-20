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
 * 넷이다. 할인 열이 서느냐, 비고 열이 서느냐, **비고가 기냐**, 그리고 **숫자 칸에 무슨 글자가 드냐**(아래 절).
 * 셋째는 이런 사정으로 생겼다 — 비고 열은 「64코어」 같은 짧은 말을 담으려고 10% 로
 * 잡았는데, 영문 한 문장이 들어오자 낱말 가운데서 끊겼다
 * (실측 2026-10-05: 「providin/g the special discoun/t for this two months rent.」).
 */

/*
 * ## 숫자 칸은 든 글자에 맞춘다 (P0147)
 *
 * 금액·할인·단가는 가장 나쁜 경우(「330,000,000원」, 「30% → 100%」)에 맞춘 고정값이었다.
 * 그래서 「70%」 하나 든 할인 칸이 116px 을 먹고 품목 이름은 116px 에 석 줄로 접혔다,
 * 정작 단가 칸에서는 「13,000,000원」이 넘쳤다(실측 2026-10-20, 1,380 화면).
 * 이제 그 견적에 든 가장 긴 글자로 폭을 세고, **남는 폭은 품목 이름이 가진다.**
 *
 * 수치는 실측이다(2026-10-20, 표 폭 728px). 13px 숫자 「13,000,000원」 82px, 할인 화살표 「30% → 100%」 87px(특별 비율이 15px 굵은 글씨이고 사이 간격 4px 둘),
 * 합계 20px 굵은 「330,000,000원」 146px, 칸 양옆 여백 합 24px. 글자당 폭은 실측보다 조금 넉넉히 잡는다.
 */

/**
 * 종이 위 표 폭. A4 폭에서 종이 여백을 뺀 값이고 넓은 화면에서도 이보다 안 넓어진다.
 * 좁은 화면의 표 최소 폭(quote-document.module.css 45.5rem)이 이 값과 같아야 셈이 맞는다
 */
export const BASIS_PX = 728
/** 칸 양옆 여백 합 (var(--space-3) 둘) */
const PAD_PX = 24
/** 13px 숫자 한 글자 */
const NUM_CHAR_PX = 8
/** 할인 칸 한 글자. 특별 비율이 15px 굵은 글씨라 숫자 칸보다 넓게 잡는다 */
const DISCOUNT_CHAR_PX = 9
/** 합계 줄 20px 굵은 숫자 한 글자 */
const GRAND_CHAR_PX = 12.5
/** 할인 칸 아래 작은 「특별 할인」 표시 한 글자 */
const TAG_CHAR_PX = 11

/** 번호 열 */
const NO = 5

/** 글자가 비어도 머리글(「단가」 「할인」 「금액」)은 서야 한다 */
const MIN_NUM_COL = 8

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

/** 숫자 칸에 실제로 들어가는 글자들. 화면이 문서에서 뽑아 넘긴다 */
export interface QuoteColumnContent {
  /** 단가 칸 글자 */
  unitPrice: readonly string[]
  /** 할인 칸 한 줄 글자(「70%」, 「30% → 100%」) */
  discount: readonly string[]
  /** 할인 칸 아래 작은 표시(「특별 할인」). 없으면 빈 배열 */
  discountTag: readonly string[]
  /** 금액 칸 13px 글자(줄 금액, 소계, 원화 환산, 매년 금액) */
  amount: readonly string[]
  /** 금액 칸 합계 줄 큰 글자 */
  grand: readonly string[]
}

export interface QuoteColumnShape {
  /** 할인 열이 서나 */
  showDiscount: boolean
  /** 비고 열이 서나 */
  showRemark: boolean
  /** 비고가 길어 폭을 더 줘야 하나. 비고 열이 안 서면 뜻이 없다 */
  longRemark?: boolean
  content: QuoteColumnContent
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

function longest(texts: readonly string[]): number {
  return texts.reduce((m, t) => Math.max(m, t.length), 0)
}

/** 글자 폭(px)을 담을 퍼센트. 올림이라 모자라지 않는다 */
function pctFor(px: number): number {
  return Math.max(MIN_NUM_COL, Math.ceil(((px + PAD_PX) / BASIS_PX) * 100))
}

/**
 * 열 폭을 정한다. **합은 늘 100 이다**(`quote-columns.test.ts` 가 센다).
 * 번호·단위·수량·비고는 지금까지의 비율 그대로고, 숫자 셋은 든 글자로 세며, 나머지가 품목 이름이다.
 */
export function quoteColumnWidths(shape: QuoteColumnShape): QuoteColumnWidths {
  const { showDiscount, showRemark, content } = shape
  const long = showRemark && shape.longRemark === true
  const remark = showRemark ? (long ? 15 : 10) : 0
  const unit = showRemark ? 6 : 7
  const quantity = showRemark ? 5 : 6
  const unitPrice = pctFor(longest(content.unitPrice) * NUM_CHAR_PX)
  const discount = showDiscount
    ? pctFor(Math.max(longest(content.discount) * DISCOUNT_CHAR_PX, longest(content.discountTag) * TAG_CHAR_PX))
    : 0
  const amount = pctFor(Math.max(longest(content.amount) * NUM_CHAR_PX, longest(content.grand) * GRAND_CHAR_PX))
  const name = 100 - NO - unit - quantity - unitPrice - discount - amount - remark
  return {
    no: NO, name, unit, quantity, unitPrice, discount, amount, remark,
  }
}

/** `18%` 꼴로 — 화면이 `style={{ width }}` 에 그대로 넣는다 */
export function pct(n: number): string {
  return `${n}%`
}
