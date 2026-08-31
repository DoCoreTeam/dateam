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

const UNKNOWN = new Set(['', '없음', '미상', '알 수 없음', 'unknown', 'n/a', 'na', 'null', '-'])

const softString = z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return UNKNOWN.has(t.toLowerCase()) ? null : t
}, z.string().min(1).max(300).nullable())

/** 금액은 **0 이상 정수**. 「1억」·「1,000만원」 같은 말은 프롬프트가 숫자로 풀어 준다 */
const amount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[,\s원]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null
}, z.number().int().min(0).nullable())

/** 수량·비율은 소수를 허용한다 — 「0.5 M/M」이 실제로 있다 */
const ratio = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[,\s%]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}, z.number().min(0).nullable())

/** 줄의 종류 — 모르는 값이 오면 «수량»으로 눕히지 않고 거절한다(라벨이 실제와 달라진다) */
const kind = z.enum(['QUANTITY', 'EFFORT', 'PERIOD', 'FIXED', 'RATIO', 'DISCOUNT']).nullable()

export const QuoteDraftOutputSchema = z.object({
  /** 견적 제목. 못 찾으면 null — 화면이 딜 이름으로 채운다 */
  title: softString,
  currency: softString,
  lines: z.array(z.object({
    name: softString,
    /** 규격·설명 */
    spec: softString,
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
  /** 「만원 단위로 잘라 주세요」 같은 말이 있으면 */
  roundingUnit: z.preprocess((v) => {
    const n = Number(v ?? 0)
    return [0, 1000, 10000, 100000, 1000000].includes(n) ? n : 0
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
