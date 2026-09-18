/**
 * 읽은 견적서와 **원문을 대조한다**
 *
 * ## 왜 이 파일이 있나
 *
 * 파일을 읽어 항목을 만드는 것까지는 AI 가 한다. 그런데 «읽었다»와 «맞게 읽었다»는 다르다 —
 * 수량 칸과 단가 칸이 바뀌어도 AI 는 성공한 것처럼 답하고, 화면은 「12건을 읽었어요」라고
 * 말한다. 사람은 그 말을 믿고 저장하고, 그 견적서가 고객에게 나간다.
 *
 * 다행히 **답이 문서 안에 이미 있다.** 견적서에는 줄마다 금액이 적혀 있고 맨 아래 합계가 있다.
 * 그 둘과 우리 계산을 맞춰 보면, 틀리게 읽은 줄이 스스로 드러난다.
 *
 * ## 두 겹으로 본다
 *
 *   ① **줄** — 수량 × 단가 − 할인 이 문서에 적힌 그 줄의 금액과 같은가
 *   ② **합계** — 우리가 낸 합계가 문서 맨 아래 합계와 같은가
 *
 * 줄이 다 맞는데 합계가 틀리면 **항목을 빠뜨린 것**이고, 줄이 틀리면 그 줄을 잘못 읽은 것이다.
 * 두 가지는 사람이 해야 할 일이 다르므로 따로 말한다.
 *
 * ## 계산은 여기서 하지 않는다
 *
 * 금액은 `quote-math` 의 `computeLine`·`computeTotals` 가 낸다.
 * 여기서 또 곱하면 **대조하는 쪽과 저장되는 쪽이 다른 계산을 하게 되고**, 그러면
 * 화면은 「맞습니다」라고 하는데 저장된 금액은 다른 일이 벌어진다.
 */

import { computeLine, computeTotals, type QuoteLineInput } from './quote-math.ts'
// 금액을 정수로 바꾸는 규칙은 한 곳이다 — 여기서 또 반올림하면 대조하는 쪽과
// 저장되는 쪽이 다른 규칙으로 금액을 만든다(money-ssot 가드)
import { toMinor } from './money.ts'

/**
 * 몇 원까지 같은 것으로 볼까.
 *
 * 견적서는 원 단위로 반올림한 숫자를 인쇄하는 일이 흔하다 — 부가세가 10%면
 * 줄마다 1원이 남는다. 항목 20줄이면 20원까지 벌어질 수 있다.
 * 그래서 **줄 하나는 1원**, 합계는 **항목 수만큼** 봐준다.
 */
export const LINE_TOLERANCE_MINOR = BigInt(1)

/** 한 줄이 통과하지 못한 이유 */
export type LineRiskReason =
  /** 단가를 못 읽었다. 그대로 넣으면 0원짜리 줄이 된다 */
  | 'no_price'
  /** 이름이 없다. 견적서에 이름 없는 줄이 인쇄된다 */
  | 'no_name'
  /** 문서에 적힌 금액과 우리 계산이 다르다 */
  | 'amount_mismatch'
  /** 원문 조각이 없어 사람이 대조할 근거가 없다 */
  | 'no_source'

export interface LineCheckInput {
  name: string
  quantity: string
  unitPriceMinor: string
  discountPercent: string
  specialDiscountPercent?: string
  taxRate: string
  /** 문서에 적힌 그 줄의 금액. 없으면 대조할 것이 없다 */
  documentAmountMinor: number | null
  /** 원문 조각 */
  sourceText: string
}

export interface LineCheck {
  /** 우리가 낸 그 줄의 금액(부가세 전) */
  ourAmountMinor: bigint
  /** 문서에 적힌 금액과의 차액. 대조할 것이 없으면 null */
  diffMinor: bigint | null
  reasons: LineRiskReason[]
  /** 아무 이유도 없으면 바로 넣어도 되는 줄이다 */
  safe: boolean
}

/**
 * 한 줄을 본다.
 *
 * **부가세는 빼고 대조한다.** 견적서의 항목 표에 적히는 금액은 공급가액이고,
 * 부가세는 맨 아래에서 한 번에 얹는 것이 한국 견적서의 관례다.
 */
export function checkLine(input: LineCheckInput): LineCheck {
  const amounts = computeLine(toMathLine(input))
  const ours = amounts.lineTotalMinor

  const reasons: LineRiskReason[] = []
  if (!input.name.trim()) reasons.push('no_name')
  // **빈 칸과 0 은 다르다.** '0' 은 「0원」이라고 읽은 것이고, '' 는 못 읽은 것이다
  if (input.unitPriceMinor.trim() === '') reasons.push('no_price')
  if (!input.sourceText.trim()) reasons.push('no_source')

  let diff: bigint | null = null
  if (input.documentAmountMinor !== null) {
    diff = ours - toMinor(input.documentAmountMinor)
    if (abs(diff) > LINE_TOLERANCE_MINOR) reasons.push('amount_mismatch')
  }

  return { ourAmountMinor: ours, diffMinor: diff, reasons, safe: reasons.length === 0 }
}

/** 합계가 어긋난 정도 */
export type TotalVerdict =
  /** 문서에 합계가 없어 대조를 못 했다 */
  | 'no_reference'
  /** 맞는다 */
  | 'match'
  /** 다르다 — 항목을 빠뜨렸거나 더 읽었다 */
  | 'mismatch'

export interface TotalCheckInput {
  lines: readonly LineCheckInput[]
  /** 문서 맨 아래의 합계 */
  documentTotalMinor: number | null
  /** 그 합계가 부가세를 포함하나 */
  documentIncludesTax: boolean
}

export interface TotalCheck {
  verdict: TotalVerdict
  /** 우리가 낸 합계 — 문서와 같은 기준(부가세 포함 여부)으로 맞춘 값 */
  ourTotalMinor: bigint
  /** 문서 합계. 없으면 null */
  documentTotalMinor: bigint | null
  /** 우리 − 문서. 대조를 못 했으면 null */
  diffMinor: bigint | null
  /** 이만큼까지는 같은 것으로 봤다 */
  toleranceMinor: bigint
}

/**
 * 합계를 본다.
 *
 * **문서와 같은 기준으로 견준다.** 문서 합계가 부가세 포함이면 우리도 포함해서 낸다 —
 * 기준이 다르면 같은 견적서가 10% 어긋난 것으로 보이고, 그 경고는 아무도 안 믿게 된다.
 */
export function checkTotal(input: TotalCheckInput): TotalCheck {
  const totals = computeTotals(input.lines.map(toMathLine))
  const ours = input.documentIncludesTax
    ? totals.netTotalMinor
    : totals.subtotalMinor - totals.discountMinor

  // 줄마다 1원씩 어긋날 수 있다. 줄이 많을수록 허용 폭도 커진다
  const tolerance = LINE_TOLERANCE_MINOR * BigInt(Math.max(1, input.lines.length))

  if (input.documentTotalMinor === null) {
    return {
      verdict: 'no_reference', ourTotalMinor: ours,
      documentTotalMinor: null, diffMinor: null, toleranceMinor: tolerance,
    }
  }

  const doc = toMinor(input.documentTotalMinor)
  const diff = ours - doc
  return {
    verdict: abs(diff) <= tolerance ? 'match' : 'mismatch',
    ourTotalMinor: ours,
    documentTotalMinor: doc,
    diffMinor: diff,
    toleranceMinor: tolerance,
  }
}

/**
 * 처음에 어떤 줄을 체크해 둘까.
 *
 * **안전한 줄만 켠다.** 스무 줄을 전부 켜 두면 사람은 훑고 그냥 넣는다 —
 * 그러면 검수가 있는 것과 없는 것이 같아진다. 위험 신호가 붙은 줄은 꺼 두어
 * **켜는 행동 자체가 「내가 봤다」는 뜻**이 되게 한다.
 */
export function initialChecked(checks: readonly LineCheck[]): boolean[] {
  return checks.map((c) => c.safe)
}

function toMathLine(l: LineCheckInput): QuoteLineInput {
  return {
    quantity: l.quantity || 0,
    unitPriceMinor: l.unitPriceMinor || 0,
    discountPercent: l.discountPercent || 0,
    specialDiscountPercent: l.specialDiscountPercent?.trim() ? l.specialDiscountPercent : null,
    taxRate: l.taxRate || 0,
  }
}

function abs(v: bigint): bigint {
  return v < BigInt(0) ? -v : v
}
