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
 *
 * ## 문서 한 장에 견적 여러 건
 *
 * 한 딜에 견적이 하나일 이유가 없다. 1안·2안이 한 장에 들어오고, 공급사에서 받은
 * 견적서와 우리가 낸 견적서가 한 파일에 붙어 오기도 한다. 그래서 최상위는 **건 목록**이고,
 * 합계와 제목과 통화는 **건마다** 따로 있다.
 *
 * 그 건을 무엇에 쓸지(새 견적·있는 견적에 붙이기·원가)는 **이 스키마가 정하지 않는다.**
 * 여기는 읽기만 한다.
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

/**
 * 한 파일에서 받을 **건 수** 상한.
 *
 * 견적서 한 벌에 안(1안·2안)이 붙거나, 공급사에서 받은 것과 우리가 낸 것이 한 장에
 * 같이 들어오는 일이 흔하다. 열 건을 넘기면 그것은 견적서가 아니라 묶음 문서이고,
 * 그때는 통째로 읽을 것이 아니라 필요한 쪽만 떼어 올려야 한다.
 *
 * **넘친 것은 조용히 버리지 않는다** — 몇 건을 못 읽었는지 화면이 말한다.
 */
export const MAX_DOC_QUOTES = 10

/**
 * 건 하나 = 견적서 한 벌.
 *
 * **왜 한 건으로 못 박지 않나**: 한 딜에 견적이 하나일 이유가 없다(사용자 지시 2026-09-19).
 * 1안·2안이 한 장에 들어오고, 받은 견적서와 우리 견적서가 한 파일에 붙어 온다.
 * 한 건으로 읽으면 두 건의 항목이 한 줄기로 섞이고, 합계 대조는 둘 중 하나와만
 * 견주게 되어 **늘 안 맞는다고 뜬다**.
 */
export const QuoteFromDocQuoteSchema = z.object({
  /**
   * 문서가 이 건을 부르는 말. 「1안」·「기본형」·「갑지」 따위. 없으면 null.
   * 화면이 건 카드 이름 옆에 그대로 붙인다 — 사람이 원문에서 그 건을 찾을 수 있어야 한다.
   */
  label: softString,
  /** 문서의 사업명·건명. 못 찾으면 null — 화면이 딜 이름을 그대로 둔다 */
  title: softString,
  currency: softString,
  /**
   * 공급받는 곳. **폼에 안 넣는다** — 받는 사람은 이 딜에 붙은 사람 중에서 고르는 값이고,
   * 문서에 적힌 이름을 그대로 넣으면 우리 CRM 에 없는 이름이 견적서에 찍힌다.
   * 사람이 「내가 올린 그 문서가 맞나」를 확인하는 데만 쓴다.
   */
  customerName: softString,
  /**
   * 이 문서를 **낸 쪽**의 상호(「공급자」 칸).
   *
   * 우리 상호와 견줘 「우리 견적 같음 / 받은 문서 같음」을 화면이 라벨로 알려 준다.
   * **그 라벨은 알림일 뿐 아무것도 바꾸지 않는다** — 원가인지 그냥 내용을 가져오려는
   * 것인지는 문서가 아니라 사람의 의도이고, 문서를 봐서는 알 수 없다.
   */
  supplierName: softString,
  /** 문서에 적힌 견적일. 확인용이고 폼에 안 넣는다 — 새 견적의 날짜는 오늘이다 */
  issuedOn: softString,
  lines: z.array(QuoteFromDocLineSchema).max(MAX_DOC_LINES),
  /**
   * 그 건 맨 아래의 **합계**. 우리 합계와 대조하는 유일한 근거다.
   * 못 찾으면 null 이고, 그때는 화면이 「대조할 합계가 없다」고 말한다.
   */
  sourceTotalMinor: amount,
  /** 그 합계가 부가세를 포함한 값인가. 「부가세 포함」·「VAT 포함」이면 true */
  sourceTotalIncludesTax: z.preprocess((v) => v === true || v === 'true', z.boolean()),
  /** 문서가 쓴 부가세율(%). 안 적혀 있으면 null — 화면 기본값을 그대로 둔다 */
  taxPercent: ratio,
})

/** 문서 한 장 — 건 목록과, 어느 건에도 못 넣은 이야기 */
export const QuoteFromDocDocSchema = z.object({
  quotes: z.array(QuoteFromDocQuoteSchema),
  /** 못 읽은 부분 — 화면이 그대로 보여 준다(조용히 버리지 않는다) */
  unclear: z.array(z.string().max(200)).max(20),
})

/**
 * 건 하나짜리 모양.
 *
 * 편집 모달의 「파일로 채우기」는 지금도 한 건을 채우는 자리라 이 모양을 쓴다.
 * 건 목록으로 온 응답이면 **첫 건**을 준다.
 */
export const QuoteFromDocOutputSchema = QuoteFromDocQuoteSchema.extend({
  unclear: z.array(z.string().max(200)).max(20),
})

export type QuoteFromDocLine = z.infer<typeof QuoteFromDocLineSchema>
export type QuoteFromDocQuote = z.infer<typeof QuoteFromDocQuoteSchema>
export type QuoteFromDocOutput = z.infer<typeof QuoteFromDocOutputSchema>

export interface QuoteFromDocDoc {
  quotes: QuoteFromDocQuote[]
  unclear: string[]
  /** 상한에 걸려 못 읽은 건 수. 0 이 아니면 화면이 그 수를 말한다 */
  droppedQuotes: number
}

/** 펜스를 벗기고 JSON 으로. 모델이 ```json 으로 감싸는 일이 흔하다 */
function toJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(trimmed)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 문자열만 골라 낸다 — 못 읽은 이야기 칸에 객체가 들어오면 화면이 [object Object] 를 그린다 */
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * 어떤 모양으로 와도 **건 목록**으로 본다.
 *
 * 모델은 지시를 따르다가도 한 건짜리 문서에서는 옛 모양(최상위 `lines`)을 돌려준다.
 * 그때 거절하면 **읽을 수 있는 문서를 못 읽었다고 말하게 된다** — 관용은 여기 한 곳에만 둔다.
 */
function toQuoteList(json: unknown): { quotes: unknown[]; unclear: string[]; dropped: number } {
  const obj = isRecord(json) ? json : {}
  const raw = Array.isArray(obj.quotes)
    ? obj.quotes
    : (Array.isArray(obj.lines) ? [obj] : [])

  // 건 안에 적힌 「못 읽음」도 함께 모은다. 문서 칸에만 있다고 보면 그 이야기가 사라진다
  const perQuote = raw.flatMap((q) => (isRecord(q) ? strings(q.unclear) : []))
  const unclear = [...strings(obj.unclear), ...perQuote].slice(0, 20)

  return {
    quotes: raw.slice(0, MAX_DOC_QUOTES),
    unclear,
    dropped: Math.max(0, raw.length - MAX_DOC_QUOTES),
  }
}

/** 문서 한 장을 건 목록으로 읽는다 */
export function parseQuoteFromDocDoc(text: string): QuoteFromDocDoc {
  const { quotes, unclear, dropped } = toQuoteList(toJson(text))
  const parsed = QuoteFromDocDocSchema.parse({ quotes, unclear })
  return { ...parsed, droppedQuotes: dropped }
}

/**
 * 건 하나만 읽는다(편집 모달의 채우기 경로).
 *
 * 건이 여럿이면 첫 건을 준다 — 어느 건을 채울지 고르는 일은 화면이 하고,
 * 그 화면은 `parseQuoteFromDocDoc` 를 쓴다.
 */
export function parseQuoteFromDoc(text: string): QuoteFromDocOutput {
  const doc = parseQuoteFromDocDoc(text)
  const first = doc.quotes[0]
  if (!first) {
    return QuoteFromDocOutputSchema.parse({ lines: [], sourceTotalIncludesTax: false, unclear: doc.unclear })
  }
  return { ...first, unclear: doc.unclear }
}
