/**
 * 표준 이탈 판정 (P0184 I08)
 *
 * 표준은 둘이다. 조항 라이브러리의 승인본, 그리고 그 계약을 만든 템플릿의 발행본.
 * 둘 다 관리자가 승인하거나 발행한 글이다. 계약서 조항이 그 글과 다르면 이탈이다.
 *
 *   ai        AI 가 새로 쓴 조항 — 법무 검토를 안 거친 글
 *   manual    사람이 새로 넣은 조항
 *   changed   표준 조항인데 글이 바뀜
 *   removed   템플릿에 있던 조항이 빠짐 (책임 한도 조항을 지우는 것도 이탈이다)
 *   unknown   표준 어디에도 없는 조항
 *
 * **같은지는 정리한 글로 견준다.** 편집기가 공백이나 빈 문단을 바꿔 저장해도 뜻이 같으면 같다.
 * 정리기는 계약서 저장과 같은 sanitizeClauseHtml 이다.
 *
 * **승인은 버전과 지문에 붙는다.** 승인 뒤 본문이 바뀌면 지문이 바뀌고 승인은 효력이 없다.
 */

import { sanitizeClauseHtml, stripTags, type Clause } from './contract-body.ts'
import { bareTitle, type ClauseText } from './contract-assemble.ts'

export type DeviationReason = 'ai' | 'manual' | 'changed' | 'removed' | 'unknown'

export interface Deviation {
  clauseId: string
  reason: DeviationReason
  title: string
}

export interface DeviationBaseline {
  /** 조항 id(clauseIdOf(키)) → 라이브러리 승인본 */
  library: ReadonlyMap<string, ClauseText>
  /** 계약을 만든 템플릿 발행본 조항. 템플릿 없이 만든 계약이면 null */
  template: readonly Clause[] | null
}

const sameText = (a: string, b: string): boolean =>
  sanitizeClauseHtml(a).replace(/<p>\s*<\/p>/g, '').replace(/\s+/g, ' ').trim()
    === sanitizeClauseHtml(b).replace(/<p>\s*<\/p>/g, '').replace(/\s+/g, ' ').trim()

const sameTitle = (a: string, b: string): boolean => bareTitle(stripTags(a)) === bareTitle(stripTags(b))

/** 계약서 조항을 표준과 견줘 이탈 목록을 낸다. 순서는 조항 순서, 빠진 조항은 맨 뒤 */
export function detectDeviations(body: readonly Clause[], baseline: DeviationBaseline): Deviation[] {
  const template = new Map((baseline.template ?? []).map((c) => [c.id, c]))
  const out: Deviation[] = body.flatMap((cl): Deviation[] => {
    const title = stripTags(cl.title)
    if (cl.origin === 'ai' || cl.origin === 'manual') return [{ clauseId: cl.id, reason: cl.origin, title }]
    const std = baseline.library.get(cl.id) ?? template.get(cl.id)
    if (!std) return [{ clauseId: cl.id, reason: 'unknown', title }]
    // 라이브러리 조항은 조립이 번호를 매기므로 번호를 뗀 제목으로 견준다
    if (!sameText(cl.html, std.html) || !sameTitle(cl.title, std.title)) return [{ clauseId: cl.id, reason: 'changed', title }]
    return []
  })
  const present = new Set(body.map((c) => c.id))
  for (const t of baseline.template ?? []) {
    if (!present.has(t.id)) out.push({ clauseId: t.id, reason: 'removed', title: stripTags(t.title) })
  }
  return out
}

export interface ApprovalRecord {
  versionNo: number
  contentHash: string
}

/** 이 버전이 체결될 수 있나 — 이탈이 없거나, 같은 버전 같은 지문의 승인이 있으면 */
export function canConcludeWith(
  deviations: readonly Deviation[], version: ApprovalRecord, approval: ApprovalRecord | null,
): boolean {
  if (deviations.length === 0) return true
  return approval !== null && approval.versionNo === version.versionNo && approval.contentHash === version.contentHash
}
