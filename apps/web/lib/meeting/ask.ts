/**
 * 이 회의에 묻기 — 순수 계산.
 *
 * 사용자 지시(2026-10-21): 회의를 띄워 둔 채 옆 패널에서 AI 에게 묻고, 근거가 달린 답을 받고,
 * 고칠 줄 제안을 골라 정리본에 반영한다.
 *
 * 규칙은 하나다 — **출처 없이 답하지 않는다**(docs/2026-09-10-ai-common-layer 질의응답).
 * 근거는 둘 중 하나만 인정한다: 실제로 있는 전사 줄 id, 또는 메모에 글자 그대로 있는 구절.
 * 둘 다 없으면 답을 버리고 「찾지 못했어요」로 바꾼다. 그럴듯한 지어낸 답이 가장 비싼 실패라서다.
 *
 * 고칠 줄 제안은 정리본 「수정」과 같은 문(parseDigestEdits → applyDigestEdits)을 지난 것만 남긴다.
 * 그 문 밖의 모양은 화면에 올라오지도 않는다.
 */

import type { DigestResult } from './digest.ts'
import { applyDigestEdits, parseDigestEdits, type DigestEdit, type DigestEditPath } from './digest-edit.ts'

export const ASK_MAX_QUESTION_CHARS = 1_000
/** 한 번에 보내는 전사 상한. 넘으면 앞에서부터 자르고 답에 「일부만 봤다」를 단다 */
export const ASK_TRANSCRIPT_MAX_CHARS = 60_000
export const ASK_MAX_SUGGESTIONS = 10
/** 메모 인용으로 인정하는 가장 짧은 길이 — 「네」 한 글자가 메모 어딘가에 있다고 근거가 되지 않게 */
const MIN_MEMO_QUOTE_CHARS = 6
const MAX_MEMO_QUOTES = 5

export const ASK_NOT_FOUND = '이 회의 기록에서는 답을 찾지 못했어요. 질문을 바꾸거나 기록에 있는 말로 물어봐 주세요.'

export interface AskSegment {
  id: string
  speaker: string
  text: string
}

export interface AskSuggestion {
  edit: DigestEdit
  /** 지금 정리본의 그 줄 — 화면이 빨강으로 그린다 */
  before: string
  /** 바뀔 글, 빈 글이면 그 줄을 지운다 — 화면이 초록으로 그린다 */
  after: string
}

export interface AskAnswer {
  answer: string
  /** 근거가 섰나. false 면 answer 는 ASK_NOT_FOUND 다 */
  found: boolean
  segmentIds: string[]
  memoQuotes: string[]
  suggestions: AskSuggestion[]
  /** 전사가 길어 앞부분만 보냈다 */
  partial: boolean
}

export function parseAskQuestion(raw: unknown): { ok: true; question: string } | { ok: false; reason: string } {
  const q = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).question : undefined
  if (typeof q !== 'string' || !q.trim()) return { ok: false, reason: '질문을 적어 주세요.' }
  const question = q.trim()
  if (question.length > ASK_MAX_QUESTION_CHARS) {
    return { ok: false, reason: `질문은 ${ASK_MAX_QUESTION_CHARS.toLocaleString()}자까지 쓸 수 있어요.` }
  }
  return { ok: true, question }
}

/** 정리본을 고칠 수 있는 주소와 함께 한 줄씩 — 제안이 가리킬 자리를 AI 가 지어내지 않게 */
export function digestLinesForPrompt(d: DigestResult): string[] {
  const out: string[] = []
  if (d.outcome) out.push(`{"kind":"outcome"} ${d.outcome}`)
  d.agenda.forEach((a, i) => {
    out.push(`{"kind":"agendaTitle","agenda":${i}} ${a.title}`)
    a.facts.forEach((f, j) => out.push(`{"kind":"fact","agenda":${i},"fact":${j}} ${f.text}`))
  })
  d.decisions.forEach((f, i) => out.push(`{"kind":"decision","index":${i}} ${f.text}`))
  if (d.nextStep) out.push(`{"kind":"nextStep"} ${d.nextStep}`)
  return out
}

export function transcriptForAsk(segments: AskSegment[]): { text: string; partial: boolean } {
  const lines: string[] = []
  let used = 0
  for (const s of segments) {
    const line = `[${s.id}] ${s.speaker}: ${s.text}`
    if (used + line.length + 1 > ASK_TRANSCRIPT_MAX_CHARS) return { text: lines.join('\n'), partial: true }
    lines.push(line)
    used += line.length + 1
  }
  return { text: lines.join('\n'), partial: false }
}

export function buildAskPrompt(input: {
  question: string
  memo: string
  segments: AskSegment[]
  digest: DigestResult | null
}): { prompt: string; partial: boolean } {
  const transcript = transcriptForAsk(input.segments)
  const digestLines = input.digest ? digestLinesForPrompt(input.digest) : []
  const prompt = [
    '너는 회의 기록을 읽고 질문에 답하는 도우미다. 아래 자료에 있는 것만으로 답한다.',
    '',
    '규칙',
    '- 자료에 없는 것은 지어내지 않는다. 모르면 found 를 false 로 두고 answer 는 비운다.',
    '- 근거는 둘 중 하나다. 전사 줄이면 그 줄 앞의 [id] 를 segmentIds 에, 메모면 메모 글을 한 글자도 바꾸지 않고 memoQuotes 에 넣는다.',
    '- 답은 한국어로 짧게, 질문에 바로 답하는 문장부터 쓴다.',
    '- 정리본에 틀린 줄이 보이면 edits 에 고칠 줄을 제안한다. path 는 정리본 줄 앞의 {...} 를 그대로 쓰고 text 는 고친 글 전체다. 지울 줄은 text 를 빈 글로 둔다. 고칠 것이 없으면 빈 배열이다.',
    '',
    '응답 JSON 모양',
    '{"found": true, "answer": "...", "segmentIds": ["..."], "memoQuotes": ["..."], "edits": [{"path": {...}, "text": "..."}]}',
    '',
    `질문: ${input.question}`,
    '',
    '[메모]',
    input.memo.trim() || '(없음)',
    '',
    `[전사]${transcript.partial ? ' (길어서 앞부분만)' : ''}`,
    transcript.text || '(없음)',
    '',
    '[정리본]',
    digestLines.length ? digestLines.join('\n') : '(없음)',
  ].join('\n')
  return { prompt, partial: transcript.partial }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 근거 id 는 실제 전사에 있는 것만, 한 번씩 */
export function keepKnownIds(v: unknown, known: ReadonlySet<string>): string[] {
  return [...new Set(arr(v).map(str).filter((id) => id && known.has(id)))]
}

/** 메모 인용은 메모에 글자 그대로 있는 것만 — 공백 차이는 같은 글로 본다 */
export function keepRealQuotes(v: unknown, memo: string): string[] {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
  const hay = squash(memo)
  const out = arr(v).map(str).map(squash).filter((q) => q.length >= MIN_MEMO_QUOTE_CHARS && hay.includes(q))
  return [...new Set(out)].slice(0, MAX_MEMO_QUOTES)
}

export function digestLineAt(d: DigestResult, p: DigestEditPath): string | null {
  switch (p.kind) {
    case 'outcome': return d.outcome
    case 'nextStep': return d.nextStep
    case 'agendaTitle': return d.agenda[p.agenda]?.title ?? null
    case 'fact': return d.agenda[p.agenda]?.facts[p.fact]?.text ?? null
    case 'decision': return d.decisions[p.index]?.text ?? null
  }
}

/** 제안 하나씩 정리본 「수정」의 문을 지나게 한다. 하나가 틀려도 나머지는 산다 */
export function keepValidSuggestions(v: unknown, base: DigestResult | null): AskSuggestion[] {
  if (!base) return []
  const out: AskSuggestion[] = []
  const seen = new Set<string>()
  for (const item of arr(v)) {
    const parsed = parseDigestEdits([item])
    if (!parsed.ok) continue
    const edit = parsed.edits[0]
    const key = JSON.stringify(edit.path)
    if (seen.has(key)) continue
    const before = digestLineAt(base, edit.path)
    if (before === null || before.trim() === edit.text.trim()) continue
    if (!applyDigestEdits(base, [edit]).ok) continue
    seen.add(key)
    out.push({ edit, before, after: edit.text })
    if (out.length >= ASK_MAX_SUGGESTIONS) break
  }
  return out
}

export function parseAskAnswer(raw: unknown, ctx: {
  knownIds: ReadonlySet<string>
  memo: string
  digest: DigestResult | null
  partial: boolean
}): AskAnswer {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const segmentIds = keepKnownIds(o.segmentIds, ctx.knownIds)
  const memoQuotes = keepRealQuotes(o.memoQuotes, ctx.memo)
  const answer = str(o.answer)
  const found = o.found !== false && answer.length > 0 && (segmentIds.length > 0 || memoQuotes.length > 0)
  if (!found) {
    return { answer: ASK_NOT_FOUND, found: false, segmentIds: [], memoQuotes: [], suggestions: [], partial: ctx.partial }
  }
  return {
    answer, found, segmentIds, memoQuotes,
    suggestions: keepValidSuggestions(o.edits, ctx.digest),
    partial: ctx.partial,
  }
}
