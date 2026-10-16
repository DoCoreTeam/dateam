/**
 * 계약서 본문 — 조항 단위로 담고, 정리하고, 지문을 뜨고, 견준다 (P0132 I05)
 *
 * **왜 조항 단위인가**: 계약서는 「제7조를 고쳤다」로 말한다. 본문을 한 덩어리 HTML 로 두면
 * 버전 비교가 글자 덩어리 비교가 되고, AI 에게 「제7조만 바꿔」라고 시킨 결과가
 * 다른 조항을 건드렸는지 셀 수 없다. 조항마다 id 가 있으면 둘 다 구조로 막힌다.
 *
 * **정리기는 여기 하나다.** 템플릿을 저장할 때, 계약서 버전을 저장할 때, 굽기 직전에
 * 같은 허용 목록을 지난다. 주간보고의 정리기는 표를 지우고, 화면의 RichText 는 속성을
 * 다 지운다 — 계약서에는 표가 있어야 하므로 그 둘을 그대로 쓰지 않는다.
 *
 * **서버에서만 부른다.** sanitize-html 과 node:crypto 를 쓴다. 화면은 비교 결과를 API 로 받는다.
 */

import sanitizeHtml from 'sanitize-html'
import { createHash } from 'node:crypto'

export interface Clause {
  /** 조항 id. 버전이 바뀌어도 같은 조항은 같은 id 를 든다 */
  id: string
  /** 「제7조 (대금 지급)」 */
  title: string
  html: string
  /** AI 가 새로 쓴 조항이면 'ai' — 법무 검토를 안 거친 글이라 버전 기록에서 갈라 보인다 */
  origin?: 'template' | 'manual' | 'ai'
}

/** 계약서 조항 수 상한 — 넘으면 저장을 거절한다 (비정상 입력 막이) */
export const MAX_CLAUSES = 200
/** 조항 하나의 HTML 길이 상한 */
export const MAX_CLAUSE_HTML = 20_000
/** 조항 제목 길이 상한 */
export const MAX_CLAUSE_TITLE = 200

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'span',
    'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    span: ['class'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    p: ['style'],
  },
  /* 문단 정렬만 받는다. 색·글꼴·위치 같은 나머지 style 은 지운다 */
  allowedStyles: { p: { 'text-align': [/^(left|right|center|justify)$/] } },
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
}

/** 사용자 HTML 을 허용 목록으로 정리한다 (보안 S4) */
export function sanitizeClauseHtml(html: string): string {
  return sanitizeHtml(html ?? '', SANITIZE_OPTS)
}

export class ClauseInputError extends Error {}

/** 밖에서 온 조항 배열을 검사하고 정리한다. 모양이 틀리면 이유를 대며 던진다 */
export function normalizeClauses(input: unknown): Clause[] {
  if (!Array.isArray(input)) throw new ClauseInputError('조항 목록이 아닙니다')
  if (input.length > MAX_CLAUSES) throw new ClauseInputError(`조항은 ${MAX_CLAUSES}개까지입니다`)
  const seen = new Set<string>()
  return input.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>
    const id = typeof c.id === 'string' && /^[\w-]{1,64}$/.test(c.id) ? c.id : ''
    if (!id) throw new ClauseInputError(`${i + 1}번째 조항의 id 가 올바르지 않습니다`)
    if (seen.has(id)) throw new ClauseInputError(`조항 id 가 겹칩니다: ${id}`)
    seen.add(id)
    const title = typeof c.title === 'string' ? c.title.trim().slice(0, MAX_CLAUSE_TITLE) : ''
    const html = typeof c.html === 'string' ? c.html : ''
    if (html.length > MAX_CLAUSE_HTML) throw new ClauseInputError(`${i + 1}번째 조항이 너무 깁니다`)
    const origin = c.origin === 'ai' || c.origin === 'manual' || c.origin === 'template' ? c.origin : undefined
    return { id, title: stripTags(title), html: sanitizeClauseHtml(html), ...(origin ? { origin } : {}) }
  })
}

/** 태그를 지우고 글자만 남긴다 (제목, 비교, AI 대조용) */
export function stripTags(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 새 조항 id — 순서대로 c1, c2 … 겹치면 다음 번호 */
export function nextClauseId(existing: readonly Clause[]): string {
  const used = new Set(existing.map((c) => c.id))
  let n = existing.length + 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

/**
 * 본문과 칸 값의 지문 (sha256). 종이 아래에 앞 여덟 자리가 찍힌다.
 * 키 순서를 고정해 같은 내용은 늘 같은 지문이 된다.
 */
export function contentHash(clauses: readonly Clause[], fieldValues: Record<string, { value: string }>): string {
  const body = clauses.map((c) => [c.id, c.title, c.html, c.origin ?? ''])
  const fields = Object.keys(fieldValues).sort().map((k) => [k, fieldValues[k].value])
  return createHash('sha256').update(JSON.stringify({ body, fields })).digest('hex')
}

/** 종이에 찍는 짧은 지문 — 네 자리씩 둘 */
export const shortHash = (hash: string): string => `${hash.slice(0, 4)} ${hash.slice(4, 8)}`

// ------------------------------------------------------------
// 비교 — 조항이 더해졌나 빠졌나 고쳐졌나, 고친 조항은 낱말 단위로
// ------------------------------------------------------------

export type DiffSeg = { type: 'same' | 'del' | 'ins'; text: string }

export interface ClauseDiff {
  id: string
  kind: 'added' | 'removed' | 'changed' | 'moved'
  before: Clause | null
  after: Clause | null
  /** 고친 조항의 글자 차이 */
  segments: DiffSeg[]
}

/** 낱말 단위 차이. 조항 하나는 길어야 몇천 자라 LCS 로 충분하다 */
export function wordDiff(a: string, b: string): DiffSeg[] {
  const x = a.split(/(\s+)/).filter((t) => t !== '')
  const y = b.split(/(\s+)/).filter((t) => t !== '')
  const n = x.length
  const m = y.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffSeg[] = []
  const push = (type: DiffSeg['type'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); i++ }
    else { push('ins', y[j]); j++ }
  }
  while (i < n) push('del', x[i++])
  while (j < m) push('ins', y[j++])
  return out
}

/** 두 버전의 조항을 견준다. 같은 조항은 목록에 안 나온다 */
export function diffClauses(before: readonly Clause[], after: readonly Clause[]): ClauseDiff[] {
  const prev = new Map(before.map((c, i) => [c.id, { c, i }]))
  const next = new Map(after.map((c, i) => [c.id, { c, i }]))
  const out: ClauseDiff[] = []
  for (const [id, { c, i }] of next) {
    const p = prev.get(id)
    if (!p) { out.push({ id, kind: 'added', before: null, after: c, segments: [{ type: 'ins', text: stripTags(c.html) }] }); continue }
    const textChanged = p.c.title !== c.title || p.c.html !== c.html
    if (textChanged) {
      const segments = wordDiff(`${p.c.title} ${stripTags(p.c.html)}`, `${c.title} ${stripTags(c.html)}`)
      out.push({ id, kind: 'changed', before: p.c, after: c, segments })
    } else if (p.i !== i) {
      out.push({ id, kind: 'moved', before: p.c, after: c, segments: [] })
    }
  }
  for (const [id, { c }] of prev) {
    if (!next.has(id)) out.push({ id, kind: 'removed', before: c, after: null, segments: [{ type: 'del', text: stripTags(c.html) }] })
  }
  return out
}

/** 칸 값 차이 — 비교 화면이 글 차이와 따로 보여 준다 */
export function diffFields(
  before: Record<string, { value: string; source: string }>,
  after: Record<string, { value: string; source: string }>,
): { key: string; before: string; after: string; source: string }[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return keys
    .filter((k) => (before[k]?.value ?? '') !== (after[k]?.value ?? ''))
    .map((k) => ({ key: k, before: before[k]?.value ?? '', after: after[k]?.value ?? '', source: after[k]?.source ?? before[k]?.source ?? 'auto' }))
}
