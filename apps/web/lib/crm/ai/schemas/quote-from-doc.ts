/**
 * 견적서 문서 → 견적 초안 출력 스키마
 *
 * ## 붙여넣기(quote-draft)와 무엇이 다른가
 *
 * 붙여넣기는 **말**을 옮긴다. 「H100 두 대」에는 검산할 근거가 없다.
 * 여기는 **이미 완성된 견적서**를 옮긴다. 그 문서에는 줄마다 금액이 적혀 있고
 * 맨 아래 합계가 적혀 있다. 즉 **답이 문서 안에 이미 있다.**
 *
 * 그래서 이 스키마는 값만 받지 않고 **검산할 거리를 함께 받는다**:
 *   · `lines[].amountMinor` — 문서에 적힌 그 줄의 금액. 우리가 수량×단가로 낸 값과 대조한다
 *   · `sourceTotalMinor` — 문서에 적힌 합계. 우리 합계와 대조한다
 *   · `lines[].sourceText` — 그 줄이 원문 어디였나. 사람이 눈으로 대조한다
 *
 * 이 셋이 없으면 «읽었다»와 «맞게 읽었다»를 구분할 방법이 없다.
 * 견적은 고객에게 나가는 문서라, 구분할 수 없는 값을 넣어서는 안 된다.
 *
 * **여기서 나오는 것도 초안이다.** 사람이 체크하고 넣기를 눌러야 폼에 들어간다(§5-3).
 */

import { z } from 'zod'
import { softString, amount, ratio, kind } from './quote-draft.ts'

/** 한 문서에서 받을 항목 수 상한. 부속명세가 붙은 견적서도 이 안에 든다 */
export const MAX_DOC_LINES = 200

/** 원문 조각의 길이 상한 — 대조용이라 그 줄만 있으면 된다 */
const MAX_SOURCE_TEXT = 300

/**
 * 원문 조각은 **반드시 있다**(빈 문자열이라도).
 *
 * nullable 로 두면 모델이 생략했을 때 화면이 `null` 을 그리게 되고,
 * 그 줄은 대조 없이 통과한다. 없으면 없다고 **보이게** 만들어야
 * 「이 줄은 근거가 없다」가 검수 대상이 된다.
 */
const sourceText = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_TEXT) : ''),
  z.string().max(MAX_SOURCE_TEXT),
)

export const QuoteFromDocLineSchema = z.object({
  name: softString,
  /** 규격·설명 */
  spec: softString,
  kind,
  quantity: ratio,
  unit: softString,
  /** 단가. **못 읽었으면 null 이다** — 0 으로 눕히면 0원짜리 줄이 조용히 들어간다 */
  unitPriceMinor: amount,
  discountPercent: ratio,
  specialDiscountPercent: ratio,
  /**
   * 문서에 적힌 그 줄의 **금액**.
   *
   * 우리가 `수량 × 단가` 로 낸 값과 대조하는 자리다. 둘이 다르면
   * 수량·단가·할인 중 하나를 잘못 읽은 것이고, 그 줄은 사람이 봐야 한다.
   */
  amountMinor: amount,
  /** 원문 어디서 왔나. 화면이 그 줄 옆에 그대로 보여 준다 */
  sourceText,
})

export const QuoteFromDocOutputSchema = z.object({
  /** 문서의 사업명·건명. 못 찾으면 null — 화면이 딜 이름을 그대로 둔다 */
  title: softString,
  currency: softString,
  /**
   * 공급받는 곳. **폼에 안 넣는다** — 받는 사람은 이 딜에 붙은 사람 중에서 고르는 값이고,
   * 문서에 적힌 이름을 그대로 넣으면 우리 CRM 에 없는 이름이 견적서에 찍힌다.
   * 사람이 「내가 올린 그 문서가 맞나」를 확인하는 데만 쓴다.
   */
  customerName: softString,
  /** 문서에 적힌 견적일. 확인용이고 폼에 안 넣는다 — 새 견적의 날짜는 오늘이다 */
  issuedOn: softString,
  lines: z.array(QuoteFromDocLineSchema).max(MAX_DOC_LINES),
  /**
   * 문서 맨 아래의 **합계**. 우리 합계와 대조하는 유일한 근거다.
   * 못 찾으면 null 이고, 그때는 화면이 「대조할 합계가 없다」고 말한다.
   */
  sourceTotalMinor: amount,
  /** 그 합계가 부가세를 포함한 값인가. 「부가세 포함」·「VAT 포함」이면 true */
  sourceTotalIncludesTax: z.preprocess((v) => v === true || v === 'true', z.boolean()),
  /** 문서가 쓴 부가세율(%). 안 적혀 있으면 null — 화면 기본값을 그대로 둔다 */
  taxPercent: ratio,
  /** 못 읽은 부분 — 화면이 그대로 보여 준다(조용히 버리지 않는다) */
  unclear: z.array(z.string().max(200)).max(20),
})

export type QuoteFromDocLine = z.infer<typeof QuoteFromDocLineSchema>
export type QuoteFromDocOutput = z.infer<typeof QuoteFromDocOutputSchema>

/**
 * 러너는 **원문 텍스트**를 준다. 모델이 ```json 펜스로 감싸는 일이 흔해 먼저 벗긴다
 * (`parseQuoteDraft` 와 같은 처리다 — 같은 일을 다르게 하지 않는다).
 */
export function parseQuoteFromDoc(text: string): QuoteFromDocOutput {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const json: unknown = JSON.parse(trimmed)
  return QuoteFromDocOutputSchema.parse(json)
}
