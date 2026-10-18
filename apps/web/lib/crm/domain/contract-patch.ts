/**
 * 계약서 AI 고치기 조각 (P0132 I09)
 *
 * **AI 는 글을 다시 쓰지 않는다. 조각만 낸다.** 조각 하나는 「몇 번째 조항의 이 글을 이렇게」다.
 * 코드가 조각마다 지금 글에 그 앞 글이 **딱 한 곳** 있는지 보고, 없거나 여러 곳이면 그 조각을 버린다.
 * 조각이 안 닿은 조항은 글자 하나 안 바뀐다.
 *
 * 반영은 사람이 한다. 받은 조각만 다음 버전이 된다 — 자동 반영은 없다.
 *
 * 숫자, 날짜, 금액이 바뀐 조각은 표시한다. 계약서에서 가장 비싼 실수가 거기서 나고,
 * 말을 다듬는 조각과 같은 무게로 보이면 사람은 그냥 받는다.
 */

import { z } from 'zod'
import { sanitizeClauseHtml, type Clause } from './contract-body.ts'
import { CONTRACT_FIELDS, scanTokens } from './contract-fields.ts'

/** 조각 수 상한 — 지시 하나에 이보다 많으면 지시가 너무 넓다 */
export const MAX_PATCHES = 30
export const MAX_BEFORE = 1000
export const MAX_AFTER = 2000
export const MAX_INSTRUCTION = 1000

export const ContractEditSchema = z.object({
  edits: z.array(z.object({
    clause: z.number().int().min(1),
    before: z.string().min(1).max(MAX_BEFORE),
    after: z.string().max(MAX_AFTER),
    why: z.string().max(200).optional().default(''),
  })).max(MAX_PATCHES),
})
export type ContractEditDoc = z.infer<typeof ContractEditSchema>
export type ContractPatch = ContractEditDoc['edits'][number]

/** 모델 답에서 JSON 하나를 꺼내 모양을 본다. 틀리면 던진다 — 러너가 한 번 더 묻는다 */
export function parseContractEdit(raw: string): ContractEditDoc {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json object')
  return ContractEditSchema.parse(JSON.parse(raw.slice(start, end + 1)))
}

export type PatchRejectWhy = 'no_clause' | 'not_found' | 'ambiguous' | 'multiline' | 'broken_field' | 'unknown_field' | 'same'

export interface PatchVerdict {
  clause: number
  before: string
  after: string
  why: string
  ok: boolean
  reject?: PatchRejectWhy
  /** 숫자, 날짜, 금액 칸이 바뀌었나 */
  numeric: boolean
}

const TOKEN = /\{\{\s*[^{}]+?\s*\}\}/g
const NUMBER = /\d[\d,.:/-]*\d|\d/g
const MONEY_OR_DATE = new Set(CONTRACT_FIELDS.filter((f) => f.kind === 'money' || f.kind === 'date').map((f) => f.key))

/** sanitize-html 이 글자를 적는 모양과 같게 — 작은따옴표는 그대로 둔다 */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 칸 자리가 통째로 들어 있나 — 「{{고객.」 처럼 반만 들면 바꾼 뒤 칸이 부서진다 */
function hasHalfToken(s: string): boolean {
  const rest = s.replace(TOKEN, '')
  return rest.includes('{{') || rest.includes('}}')
}

/** 태그 안(속성)이 아니라 글자 자리인가 */
function inText(html: string, at: number): boolean {
  return html.lastIndexOf('<', at) <= html.lastIndexOf('>', at)
}

/** 글자 자리에서 몇 번 나오나, 그리고 첫 자리 */
function findInText(html: string, needle: string): { count: number; at: number } {
  let count = 0
  let first = -1
  for (let i = html.indexOf(needle); i >= 0; i = html.indexOf(needle, i + 1)) {
    if (!inText(html, i)) continue
    count++
    if (first < 0) first = i
  }
  return { count, at: first }
}

const numbersOf = (s: string): string[] => (s.replace(TOKEN, '').match(NUMBER) ?? []).sort()
const moneyDateTokensOf = (s: string): string[] => scanTokens(s).known.filter((k) => MONEY_OR_DATE.has(k)).sort()

/** 숫자나 금액 날짜 칸이 앞뒤로 달라졌나 */
export function touchesNumbers(before: string, after: string): boolean {
  return numbersOf(before).join('|') !== numbersOf(after).join('|')
    || moneyDateTokensOf(before).join('|') !== moneyDateTokensOf(after).join('|')
}

/** 조각 하나를 조항 HTML 에 대 본다. 바꾼 HTML 이나 버리는 까닭을 준다 */
export function applyPatchToHtml(html: string, p: Pick<ContractPatch, 'before' | 'after'>): { html: string } | { reject: PatchRejectWhy } {
  if (/[\r\n]/.test(p.before) || /[\r\n]/.test(p.after)) return { reject: 'multiline' }
  if (p.before === p.after) return { reject: 'same' }
  if (hasHalfToken(p.before) || hasHalfToken(p.after)) return { reject: 'broken_field' }
  if (scanTokens(p.after).unknown.length > 0) return { reject: 'unknown_field' }
  const needle = escapeText(p.before)
  const { count, at } = findInText(html, needle)
  if (count === 0) return { reject: 'not_found' }
  if (count > 1) return { reject: 'ambiguous' }
  return { html: sanitizeClauseHtml(html.slice(0, at) + escapeText(p.after) + html.slice(at + needle.length)) }
}

/**
 * 조각마다 판정 — **지금 본문 하나에 하나씩** 대 본다(제안 화면용).
 * 조각끼리 겹치는지는 반영할 때 순서대로 대 보며 잡는다.
 */
export function judgePatches(body: readonly Clause[], patches: readonly ContractPatch[]): PatchVerdict[] {
  return patches.map((p) => {
    const base = { clause: p.clause, before: p.before, after: p.after, why: p.why ?? '', numeric: touchesNumbers(p.before, p.after) }
    const target = body[p.clause - 1]
    if (!target) return { ...base, ok: false, reject: 'no_clause' as const }
    const r = applyPatchToHtml(target.html, p)
    return 'reject' in r ? { ...base, ok: false, reject: r.reject } : { ...base, ok: true }
  })
}

export class PatchApplyError extends Error {
  readonly index: number
  readonly why: PatchRejectWhy
  constructor(index: number, why: PatchRejectWhy) {
    super(`patch ${index}: ${why}`)
    this.index = index
    this.why = why
  }
}

/**
 * 사람이 받은 조각을 순서대로 반영한 새 본문. 하나라도 안 맞으면 던진다 — 반쯤 반영한 본문은 없다.
 * 닿은 조항은 출처를 'ai' 로 적는다(법무 검토를 안 거친 글).
 */
export function applyPatches(body: readonly Clause[], patches: readonly Pick<ContractPatch, 'clause' | 'before' | 'after'>[]): Clause[] {
  const out = body.map((c) => ({ ...c }))
  patches.forEach((p, i) => {
    const target = out[p.clause - 1]
    if (!target) throw new PatchApplyError(i, 'no_clause')
    const r = applyPatchToHtml(target.html, p)
    if ('reject' in r) throw new PatchApplyError(i, r.reject)
    out[p.clause - 1] = { ...target, html: r.html, origin: 'ai' }
  })
  return out
}
