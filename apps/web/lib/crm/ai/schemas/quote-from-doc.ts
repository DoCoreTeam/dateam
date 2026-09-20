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
 * ## 구성을 담을 자리가 있다
 *
 * 견적서의 한 항목은 이름 한 줄로 끝나지 않는다. 섀시 한 줄 밑에 무엇이 들어갔는지가
 * 열 줄 넘게 붙는다. 예전에는 그 자리가 **규격 한 줄**뿐이라 읽는 쪽이 버릴 수밖에 없었다
 * (실측 2026-09-20: 원본 20줄 가운데 6줄만 들어오고 구성 13줄이 통째로 사라졌다).
 *
 * 그래서 항목마다 `components` 를 둔다. 규격에 우겨 넣지 않는 이유는 둘이다 —
 * 우겨 넣으면 길이 상한에 걸려 **문서 전체 읽기가 실패**하고, 몇 줄을 읽었는지도 셀 수 없다.
 *
 * ## 넘치면 잘라 말한다, 죽지 않는다
 *
 * 상한을 넘는 값이 오면 예전에는 zod 가 던졌고 그러면 **그 문서 전체를 못 읽었다.**
 * 한 줄이 길다고 견적서 한 장을 통째로 버리는 것은 어떤 경우에도 옳지 않다.
 * 그래서 넘치는 것은 자르고, **몇 개를 잘랐는지 함께 돌려준다** — 화면이 그 수를 말한다.
 *
 * ## 문서 한 장에 견적 여러 건
 *
 * 한 딜에 견적이 하나일 이유가 없다. 1안·2안이 한 장에 들어오고, 공급사에서 받은
 * 견적서와 우리가 낸 견적서가 한 파일에 붙어 오기도 한다. 그래서 최상위는 **건 목록**이고,
 * 합계와 제목과 통화는 **건마다** 따로 있다.
 *
 * 그 건을 무엇에 쓸지(새 견적·있는 견적에 붙이기·원가)는 **이 스키마가 정하지 않는다.**
 * 여기는 읽기만 한다.
 *
 * ## 어느 쪽에서 왔는지도 받는다
 *
 * 건과 줄마다 쪽 번호를 받는다. 이 값이 없으면 한 파일에서 나온 견적 둘이 각자
 * 「내가 이 파일의 어디인가」를 말할 수 없고, 대조 화면은 늘 1쪽부터 열린다.
 * 원문에 쪽 표시를 심어 두었으므로(`services/quote-source-text.ts`) 모델은
 * 그 표시를 **옮겨 적기만** 한다.
 */

import { z } from 'zod'
import {
  softString, amount, ratio, kind,
  componentsField, MAX_DOC_COMPONENT_LINES, MAX_COMPONENT_TEXT,
} from './quote-draft.ts'

/*
  구성 줄 규칙은 **붙여넣기 스키마와 한 벌**이다 — 여기서 다시 적으면 파일로 읽은 견적과
  붙여넣기로 만든 견적이 다른 모양이 된다. 이름은 그대로 내보내 부르던 곳이 안 깨지게 둔다.
*/
export { MAX_DOC_COMPONENT_LINES, MAX_COMPONENT_TEXT }

/** 한 문서에서 받을 항목 수 상한. 부속명세가 붙은 견적서도 이 안에 든다 */
export const MAX_DOC_LINES = 200

/** 원문 조각의 길이 상한 — 대조용이라 그 줄만 있으면 된다 */
const MAX_SOURCE_TEXT = 300

/**
 * 읽을 때 쓸 상한.
 *
 * **왜 인자로 받나**: 부속명세가 열 장 붙는 견적서를 다루는 회사와 한 장짜리만 쓰는
 * 회사가 같은 상한을 쓸 이유가 없다. 설정에서 오고, 설정이 없으면 아래 기본값이다
 * (`services/quote-import-config.ts`).
 */
export interface DocLimits {
  maxLines: number
  maxComponentLines: number
}

export const DEFAULT_DOC_LIMITS: DocLimits = {
  maxLines: MAX_DOC_LINES,
  maxComponentLines: MAX_DOC_COMPONENT_LINES,
}

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

/**
 * 쪽 번호. 모델이 원문의 쪽 표시를 옮겨 적은 값이다.
 *
 * 못 옮겼으면 null 이고, 그때는 **조각을 만들지 않는다** —
 * 틀린 쪽에서 오린 그림이 맞는 것처럼 보이는 것이 제일 나쁘다.
 */
const pageNo = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[^\d]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}, z.number().int().min(1).nullable())

/** 항목 목록도 같은 이유로 자른다 */
function linesField(limits: DocLimits) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, limits.maxLines) : []),
    z.array(quoteFromDocLineSchema(limits)),
  )
}

export function quoteFromDocLineSchema(limits: DocLimits) {
  return z.object({
    name: softString,
    /** 규격·설명 — 한 줄짜리 요약이다. 여러 줄은 components 로 간다 */
    spec: softString,
    /**
     * 이 항목에 딸린 구성 줄.
     *
     * 원본 표에서 **품목 칸이 비어 있고 설명만 이어지는 행**들이 여기로 온다.
     * 예전에는 그런 행을 「항목이 아니다」라며 버렸고, 그래서 섀시 구성 13줄이 사라졌다.
     */
    components: componentsField(limits.maxComponentLines),
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
    /** 그 줄이 있던 쪽. 원문의 쪽 표시를 옮긴 값이다 */
    sourcePage: pageNo,
    /**
     * 원본이 이 줄을 묶어 부르는 말(「하드웨어」·「소프트웨어」·「용역」).
     *
     * 견적에는 묶음과 소계가 이미 있다. 원본이 갈라 놓은 것을 평평하게 펴서 받으면
     * 사람이 그 묶음을 다시 손으로 만들어야 한다.
     */
    groupLabel: softString,
  })
}

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
export function quoteFromDocQuoteSchema(limits: DocLimits) {
  return z.object({
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
    lines: linesField(limits),
    /**
     * 그 건 맨 아래의 **합계**. 우리 합계와 대조하는 유일한 근거다.
     * 못 찾으면 null 이고, 그때는 화면이 「대조할 합계가 없다」고 말한다.
     */
    sourceTotalMinor: amount,
    /** 그 합계가 부가세를 포함한 값인가. 「부가세 포함」·「VAT 포함」이면 true */
    sourceTotalIncludesTax: z.preprocess((v) => v === true || v === 'true', z.boolean()),
    /** 문서가 쓴 부가세율(%). 안 적혀 있으면 null — 화면 기본값을 그대로 둔다 */
    taxPercent: ratio,
    /** 이 건이 시작하는 쪽 */
    pageStart: pageNo,
    /** 이 건이 끝나는 쪽. 한 쪽에 다 들어가면 pageStart 와 같다 */
    pageEnd: pageNo,
  })
}

/** 문서 한 장 — 건 목록과, 어느 건에도 못 넣은 이야기 */
export function quoteFromDocDocSchema(limits: DocLimits) {
  return z.object({
    quotes: z.array(quoteFromDocQuoteSchema(limits)),
    /** 못 읽은 부분 — 화면이 그대로 보여 준다(조용히 버리지 않는다) */
    unclear: z.array(z.string().max(200)).max(20),
  })
}

/**
 * 건 하나짜리 모양.
 *
 * 편집 모달의 「파일로 채우기」는 지금도 한 건을 채우는 자리라 이 모양을 쓴다.
 * 건 목록으로 온 응답이면 **첫 건**을 준다.
 */
export function quoteFromDocOutputSchema(limits: DocLimits) {
  return quoteFromDocQuoteSchema(limits).extend({
    unclear: z.array(z.string().max(200)).max(20),
  })
}

/*
  기본 상한으로 굳힌 판. 상한을 안 주는 자리(시험·옛 호출)가 그대로 돈다 —
  같은 모양을 두 번 적지 않으려고 위 공장에서 만든다.
*/
export const QuoteFromDocLineSchema = quoteFromDocLineSchema(DEFAULT_DOC_LIMITS)
export const QuoteFromDocQuoteSchema = quoteFromDocQuoteSchema(DEFAULT_DOC_LIMITS)
export const QuoteFromDocDocSchema = quoteFromDocDocSchema(DEFAULT_DOC_LIMITS)
export const QuoteFromDocOutputSchema = quoteFromDocOutputSchema(DEFAULT_DOC_LIMITS)

export type QuoteFromDocLine = z.infer<typeof QuoteFromDocLineSchema>
export type QuoteFromDocQuote = z.infer<typeof QuoteFromDocQuoteSchema>
export type QuoteFromDocOutput = z.infer<typeof QuoteFromDocOutputSchema>

export interface QuoteFromDocDoc {
  quotes: QuoteFromDocQuote[]
  unclear: string[]
  /** 상한에 걸려 못 읽은 건 수. 0 이 아니면 화면이 그 수를 말한다 */
  droppedQuotes: number
  /** 상한에 걸려 못 읽은 항목 수 */
  droppedLines: number
  /** 상한에 걸려 못 읽은 구성 줄 수 */
  droppedComponents: number
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

/**
 * 자르기 전에 **몇 개를 자를지 센다.**
 *
 * zod 안에서는 셀 수 없다(preprocess 는 값만 바꾼다). 그런데 세지 않으면
 * 화면은 「항목 200건을 읽었습니다」라고 말하는데 원문에는 260건이 있다 —
 * 사람은 그 200건을 전부로 믿고 저장한다.
 */
function countDropped(quotes: unknown[], limits: DocLimits): { lines: number; components: number } {
  let lines = 0
  let components = 0
  for (const q of quotes) {
    if (!isRecord(q)) continue
    const raw = Array.isArray(q.lines) ? q.lines : []
    lines += Math.max(0, raw.length - limits.maxLines)
    for (const line of raw.slice(0, limits.maxLines)) {
      if (!isRecord(line)) continue
      const comps = Array.isArray(line.components) ? line.components : []
      components += Math.max(0, comps.length - limits.maxComponentLines)
    }
  }
  return { lines, components }
}

/** 문서 한 장을 건 목록으로 읽는다 */
export function parseQuoteFromDocDoc(text: string, limits: DocLimits = DEFAULT_DOC_LIMITS): QuoteFromDocDoc {
  const { quotes, unclear, dropped } = toQuoteList(toJson(text))
  const cut = countDropped(quotes, limits)
  const parsed = quoteFromDocDocSchema(limits).parse({ quotes, unclear })
  return { ...parsed, droppedQuotes: dropped, droppedLines: cut.lines, droppedComponents: cut.components }
}

/**
 * 건 하나만 읽는다(편집 모달의 채우기 경로).
 *
 * 건이 여럿이면 첫 건을 준다 — 어느 건을 채울지 고르는 일은 화면이 하고,
 * 그 화면은 `parseQuoteFromDocDoc` 를 쓴다.
 */
export function parseQuoteFromDoc(text: string, limits: DocLimits = DEFAULT_DOC_LIMITS): QuoteFromDocOutput {
  const doc = parseQuoteFromDocDoc(text, limits)
  const first = doc.quotes[0]
  if (!first) {
    return quoteFromDocOutputSchema(limits).parse({ lines: [], sourceTotalIncludesTax: false, unclear: doc.unclear })
  }
  return { ...first, unclear: doc.unclear }
}
