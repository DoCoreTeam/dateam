/**
 * 자연어 → 견적 초안 출력 스키마
 *
 * **AI 가 견적을 «만들지» 않는다.** 여기서 나오는 것은 편집 화면에 채워질 «초안»이고,
 * 사람이 보고 고친 뒤에야 저장된다(§5-3 추출/제안형 — 자동 등록 금지).
 *
 * 스키마가 문을 닫는 이유: 금액이 느슨하게 들어오면 「1억」이 `100000000` 인지
 * `1` 인지 알 수 없는 값이 그대로 단가가 되고, **0원짜리 견적이 조용히 만들어진다**.
 */

import { z } from 'zod'
import { ROUNDING_UNITS } from '../../domain/quote-math.ts'

const UNKNOWN = new Set(['', '없음', '미상', '알 수 없음', 'unknown', 'n/a', 'na', 'null', '-'])

/*
  아래 넷은 **견적 문서 읽기 스키마(quote-from-doc)도 그대로 쓴다.**
  같은 「1억 2천만원」을 두 스키마가 다르게 풀면, 붙여넣기로 넣은 견적과
  파일로 넣은 견적의 금액이 갈린다. 그래서 자리를 하나로 둔다.
*/
/**
 * 짧은 글 한 칸의 길이 상한.
 *
 * **넘으면 자른다, 던지지 않는다.** 예전에는 `.max()` 가 그대로 던져서
 * 규격 한 칸이 길다는 이유로 **견적서 문서 전체를 못 읽었다**(실측 2026-09-20,
 * 420자 규격 → too_big → 문서 통째 실패). 한 칸이 길다고 한 장을 버리는 것은
 * 어떤 경우에도 옳지 않다. 여러 줄짜리 설명은 `components` 로 간다.
 */
export const MAX_SOFT_TEXT = 300

export const softString = z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim().slice(0, MAX_SOFT_TEXT)
  return UNKNOWN.has(t.toLowerCase()) ? null : t
}, z.string().min(1).max(MAX_SOFT_TEXT).nullable())

/** 금액은 **0 이상 정수**. 「1억」·「1,000만원」 같은 말은 프롬프트가 숫자로 풀어 준다 */
export const amount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[,\s원]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null
}, z.number().int().min(0).nullable())

/** 수량·비율은 소수를 허용한다 — 「0.5 M/M」이 실제로 있다 */
export const ratio = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[,\s%]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}, z.number().min(0).nullable())

/** 줄의 종류 — 모르는 값이 오면 «수량»으로 눕히지 않고 거절한다(라벨이 실제와 달라진다) */
export const kind = z.enum(['QUANTITY', 'EFFORT', 'PERIOD', 'FIXED', 'RATIO', 'DISCOUNT']).nullable()

/**
 * 항목 하나에 딸릴 구성 줄 수 상한.
 *
 * 서버 섀시 한 대의 구성이 실측 13줄이었다. 마흔이면 그런 항목이 세 벌 붙어도 든다.
 * **이 숫자는 여기 한 곳에만 있다** — 설정 기본값도 이 값을 가리킨다.
 */
export const MAX_DOC_COMPONENT_LINES = 40

/** 구성 한 줄의 길이 상한. 한 줄이 이보다 길면 그것은 구성이 아니라 문단이다 */
export const MAX_COMPONENT_TEXT = 200

/**
 * 구성 줄 목록. 넘치는 것은 **자른다** — 던지면 그 문서 전체를 못 읽는다.
 *
 * **두 경로가 같은 것을 쓴다.** 파일로 읽든 말로 붙여넣든 구성이 담기는 모양은 하나여야
 * 한다. 두 벌이면 한쪽만 자르거나 한쪽만 빈 줄을 남기고, 같은 내용이 넣는 방법에 따라
 * 달라진다 — 그 차이는 사람이 설명할 수 없다.
 */
export function componentsField(limit: number) {
  return z.preprocess((v) => {
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPONENT_TEXT))
      .filter((t) => t.length > 0)
      .slice(0, limit)
  }, z.array(z.string().max(MAX_COMPONENT_TEXT)))
}

export const QuoteDraftOutputSchema = z.object({
  /** 견적 제목. 못 찾으면 null — 화면이 딜 이름으로 채운다 */
  title: softString,
  currency: softString,
  lines: z.array(z.object({
    name: softString,
    /** 규격·설명 — **한 줄 요약**이다. 여러 줄은 components 로 간다 */
    spec: softString,
    /**
     * 그 항목에 딸린 구성 줄.
     *
     * **파일 경로에만 두면 같은 화면이 두 결과를 낸다.** 사람은 견적서를 파일로도 올리고
     * 표를 통째로 붙여넣기도 하는데, 붙여넣기만 구성을 못 받으면 같은 내용이
     * 어떻게 넣었느냐에 따라 달라진다 — 그 차이는 아무도 설명할 수 없다.
     * 담고 자르는 규칙은 문서 스키마 한 곳에서 온다.
     */
    components: componentsField(MAX_DOC_COMPONENT_LINES),
    /**
     * 비고 — 원본 표 맨 오른쪽 열.
     *
     * **규격과 다르다.** 규격은 물건이 무엇인가이고(「AMD EPYC 9355 32C/64T」),
     * 비고는 이 견적에서 그 줄이 무슨 구실인가다(「서버 새시」「64코어」「Raid5」).
     * 우리 양식에 원래 있던 열인데 담을 칸이 없어 읽어도 버려졌다(사용자 지적 2026-09-21).
     */
    remark: softString,
    kind,
    quantity: ratio,
    unit: softString,
    /** 단가(minor 단위 정수) */
    unitPriceMinor: amount,
    /** 기본 할인율(%) */
    discountPercent: ratio,
    /** 특별 할인율(%) — 「이번엔 80%」처럼 따로 말했을 때만 */
    specialDiscountPercent: ratio,
  })).max(50),
  /**
   * **「부가세 포함 3억에 맞춰 줘」의 의도**(v0.7.695).
   *
   * AI 는 «얼마에 맞춰 달라»는 뜻만 읽고, 단가는 `quote-target.ts` 가 낸다 —
   * 견적은 고객에게 나가는 문서라 AI 가 푼 숫자를 그대로 제안가로 쓰지 않는다.
   * 예전엔 이 자리가 없어 「부가세포함」·「수준에 맞춰서」가 통째로 unclear 로 갔다.
   */
  targetTotalMinor: amount,
  /** 그 금액이 부가세를 포함한 값인가. 「부가세 포함」·「VAT 포함」이면 true */
  targetIncludesTax: z.preprocess((v) => v === true || v === 'true', z.boolean()),
  /** 항목마다 적용할 부가세율(%). 안 말했으면 null — 화면 기본값을 그대로 둔다 */
  taxPercent: ratio,
  /** 「만원 단위로 잘라 주세요」 같은 말이 있으면 */
  roundingUnit: z.preprocess((v) => {
    const n = Number(v ?? 0)
    // 허용 목록은 quote-math 한 곳이다 — 여기 또 적으면 단위를 늘려도 AI 값만 버려진다
    return (ROUNDING_UNITS as readonly number[]).includes(n) ? n : 0
  }, z.number().int()),
  /** AI 가 못 알아본 부분 — 화면이 그대로 보여 준다(조용히 버리지 않는다) */
  unclear: z.array(z.string().max(200)).max(10),
})

export type QuoteDraftOutput = z.infer<typeof QuoteDraftOutputSchema>

/**
 * **러너는 «원문 텍스트»를 준다** — 객체가 아니다.
 *
 * 처음엔 스키마에 바로 넘겼다가 `Expected object, received string` 으로 실패했다.
 * 모델은 답을 ```json 코드펜스로 감싸 주는 일이 흔하므로 그것부터 벗긴다
 * (`parseQuickCreate` 와 같은 처리다 — 같은 자리에서 같은 일을 한다).
 */
export function parseQuoteDraft(text: string): QuoteDraftOutput {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const json: unknown = JSON.parse(trimmed)
  return QuoteDraftOutputSchema.parse(json)
}
