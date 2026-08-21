/**
 * 회사 웹 보강 출력 스키마
 *
 * AI 가 준 텍스트는 **여기를 통과해야만** 서비스가 본다.
 * 통과 못 하면 러너가 한 번 더 묻고, 그래도 안 되면 제안을 하나도 만들지 않는다.
 *
 * 느슨하게 받으면 어떻게 되는지는 quick-create 스키마에 적힌 그대로다 —
 * "산업: 알 수 없음"이 진짜 산업군처럼 목록에 남는다. 여기서는 하나가 더 있다:
 * **지역에 도로명 주소가, 직원 수에 "약 50명"이 들어오면** 나중에 그 칸으로 거르는 일이 영영 안 된다.
 * 그래서 구간은 고정 값으로 받고, 벗어나면 값이 아니라 null 로 접는다.
 */

import { z } from 'zod'
import { EMPLOYEE_RANGES } from '../prompts/company-enrich.v1.ts'

/** 빈 문자열·공백·"없음"류는 null 로 접는다 — 모른다는 사실을 값으로 위장하지 않는다 */
const UNKNOWN = new Set(['', '없음', '미상', '알 수 없음', '확인 불가', 'unknown', 'n/a', 'na', 'null', '-'])

const softString = (max: number) => z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return UNKNOWN.has(t.toLowerCase()) ? null : t
}, z.string().min(1).max(max).nullable())

/**
 * 도메인은 호스트만 남긴다.
 *
 * 모델은 지시를 어기고 "https://acme.co.kr/about" 을 주는 일이 흔하다.
 * 그대로 저장하면 도메인 기준 중복 판정(quick-create §3.1-5)이 깨져
 * 같은 회사가 둘로 늘어난다 — 정규화는 코드가 한다.
 */
const domainish = z.preprocess((v) => {
  if (typeof v !== 'string') return v ?? null
  let t = v.trim().toLowerCase()
  if (UNKNOWN.has(t)) return null
  t = t.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  t = t.split('/')[0].split('?')[0].split('#')[0].trim()
  // 점이 없으면 도메인이 아니다("모름"·"홈페이지없음" 같은 답을 걸러낸다)
  return t.includes('.') ? t : null
}, z.string().min(3).max(253).nullable())

/**
 * 구간을 벗어난 값은 **버린다.**
 *
 * "약 50명"을 51-200 으로 옮겨 주고 싶은 유혹이 있는데, 그러면 모델이 준
 * 근거 없는 추정이 우리 손을 거쳐 확정값이 된다. 모르면 모르는 채로 둔다.
 */
const employeeRange = z.preprocess((v) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return (EMPLOYEE_RANGES as readonly string[]).includes(t) ? t : null
}, z.enum(EMPLOYEE_RANGES).nullable())

export const CompanyEnrichOutputSchema = z.object({
  matched: z.preprocess((v) => v === true || v === 'true', z.boolean()),
  matchReason: softString(500),
  domain: domainish,
  industry: softString(60),
  region: softString(40),
  employeeRange,
  descriptionMd: softString(2000),
})

export type CompanyEnrichOutput = z.infer<typeof CompanyEnrichOutputSchema>

/** 보강이 실제로 제안할 수 있는 필드 — 화면·서비스가 이 목록 하나만 본다(SSOT) */
export const ENRICHABLE_FIELDS = ['domain', 'industry', 'region', 'employeeRange', 'descriptionMd'] as const
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

/**
 * AI 응답 텍스트를 스키마로 옮긴다.
 *
 * 코드펜스를 벗기는 이유는 quick-create 와 같다 — 모델이 지시를 어기고 ```json 을 붙이는 일이 흔하고,
 * 그걸로 실패 처리하면 멀쩡한 답을 두 번 묻게 된다.
 *
 * 웹 검색을 켜면 하나가 더 생긴다: 모델이 JSON 앞뒤에 "검색해 보니…" 같은 말을 붙인다.
 * 그래서 **첫 { 부터 마지막 } 까지**를 잘라 쓴다.
 */
export function parseCompanyEnrich(text: string): CompanyEnrichOutput {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start > 0 || (end >= 0 && end < t.length - 1)) {
    if (start >= 0 && end > start) t = t.slice(start, end + 1)
  }
  const json: unknown = JSON.parse(t)
  return CompanyEnrichOutputSchema.parse(json)
}
