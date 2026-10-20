/**
 * AI 검토 — 글과 표가 어긋난 곳 (사람이 「AI로 한 번 더 보기」를 누를 때만)
 *
 * 규칙이 못 잡는 것, 뜻을 읽어야 하는 것만 본다.
 *   QTY_MISMATCH  글에는 4장인데 표에는 40장
 *   NAMING        같은 것의 이름 표기가 제각각(「H100 SXM5」, 「에이치백」)
 *   MISSING       글에는 있는데 표에 빠진 것(「교육 2회」)
 *   WRONG_SECTION 사업 유형을 잘못 나눔(크레딧을 솔루션 묶음에)
 *
 * 고칠 값으로 쓰는 것은 앞의 둘뿐이다. 빠진 것과 묶음은 알림이다 — 금액이 따라 움직이는 일이라
 * AI 가 표를 바꾸게 두지 않는다. 금액 칸은 이 모양에 없다.
 */

import { z } from 'zod'

export const REVIEW_KINDS = ['QTY_MISMATCH', 'NAMING', 'MISSING', 'WRONG_SECTION'] as const
export type ReviewKind = typeof REVIEW_KINDS[number]

/** AI 에게 보내는 것 — 글과 표의 이름, 수량, 단위, 묶음. 금액과 원가는 없다 */
export interface TextReviewInput {
  text: string
  lines: { key: string; name: string; quantity: string; unit: string; section: string | null }[]
}

const short = z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 200) : v), z.string().min(1))

export const ReviewFindingSchema = z.object({
  kind: z.enum(REVIEW_KINDS),
  key: z.string().max(200).nullable().optional().default(null),
  note: short,
  /** QTY_MISMATCH 면 글이 말한 수량 */
  quantity: z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().positive().max(1_000_000).nullable()).optional().default(null),
  /** NAMING 이면 통일할 이름 */
  name: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 120) : null), z.string().nullable()).optional().default(null),
}).strict()

export const ReviewOutputSchema = z.object({ findings: z.array(ReviewFindingSchema).max(30) })
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>

export function parseReview(text: string): ReviewOutput {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return ReviewOutputSchema.parse(JSON.parse(trimmed))
}

export interface ReviewFix { key: string; field: 'quantity' | 'name'; value: string; note: string }
export interface ReviewNotice { kind: ReviewKind; note: string }

/** 표에 있는 키만, 잠근 칸은 안 고치고, 고칠 값은 수량과 이름뿐 */
export function reviewToFixes(
  out: ReviewOutput,
  lines: readonly { key: string; lockedFields: readonly string[] }[],
): { fixes: ReviewFix[]; notices: ReviewNotice[] } {
  const byKey = new Map(lines.map((l) => [l.key, l]))
  const fixes: ReviewFix[] = []
  const notices: ReviewNotice[] = []
  for (const f of out.findings) {
    const line = f.key ? byKey.get(f.key) : undefined
    if (f.kind === 'QTY_MISMATCH' && line && f.quantity !== null && !line.lockedFields.includes('quantity')) {
      fixes.push({ key: line.key, field: 'quantity', value: String(f.quantity), note: f.note })
    } else if (f.kind === 'NAMING' && line && f.name && !line.lockedFields.includes('name')) {
      fixes.push({ key: line.key, field: 'name', value: f.name, note: f.note })
    } else if (f.kind === 'MISSING' || f.kind === 'WRONG_SECTION') {
      notices.push({ kind: f.kind, note: f.note })
    }
  }
  return { fixes, notices }
}
