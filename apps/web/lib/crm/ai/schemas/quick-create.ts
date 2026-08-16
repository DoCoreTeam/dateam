/**
 * 원터치 생성 출력 스키마 (dacrm T1-05, 구현명세 §3.1-3)
 *
 * AI 가 준 텍스트를 **여기를 통과해야만** 서비스가 본다.
 * 통과 못 하면 러너가 한 번 더 묻고, 그래도 안 되면 레코드를 만들지 않는다.
 *
 * 느슨하게 받으면(예: 아무 문자열이나 회사명으로) AI 가 "회사명: 알 수 없음" 같은 값을
 * 만들어 넣고, 그게 진짜 회사로 목록에 남는다. 스키마가 그 문을 닫는 유일한 장치다.
 */

import { z } from 'zod'

/** 빈 문자열·공백·"없음"류는 null 로 접는다 — 모른다는 사실을 값으로 위장하지 않는다 */
const UNKNOWN = new Set(['', '없음', '미상', '알 수 없음', 'unknown', 'n/a', 'na', 'null', '-'])

const softString = z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return UNKNOWN.has(t.toLowerCase()) ? null : t
}, z.string().min(1).max(300).nullable())

/** 금액은 0 이상 정수 — 음수·소수는 AI 가 단위를 잘못 푼 것이다 */
const amount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null
}, z.number().int().min(0).nullable())

export const QuickCreateOutputSchema = z.object({
  company: z.object({
    name: softString,
    domain: softString,
    industry: softString,
    region: softString,
  }).nullable(),
  person: z.object({
    name: softString,
    email: softString,
    phone: softString,
    title: softString,
  }).nullable(),
  deal: z.object({
    name: softString,
    amountMinor: amount,
    currency: softString,
  }).nullable(),
  notes: softString,
})

export type QuickCreateOutput = z.infer<typeof QuickCreateOutputSchema>

/**
 * AI 응답 텍스트를 스키마로 옮긴다.
 *
 * 코드펜스를 벗기는 이유: 모델이 지시를 어기고 ```json 을 붙이는 일이 흔하다.
 * 그걸로 실패 처리하면 멀쩡한 답을 두 번 묻게 된다.
 */
export function parseQuickCreate(text: string): QuickCreateOutput {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const json: unknown = JSON.parse(trimmed)
  return QuickCreateOutputSchema.parse(json)
}
