/**
 * 정리본을 **사람이 그 자리에서** 고친다 — 순수 계산.
 *
 * 사용자 지시(2026-10-21): *"직접 그부분 한글자만 고치면 되는데 AI를 쓰는게 오히려 손해잖아"*.
 * 예전엔 정리본에 들어가는 길이 「다시 정리(AI)」 하나라 오타 하나를 고치려면 AI 를 다시 돌려야 했다.
 *
 * **글자만 바꾼다.** 근거 줄(segmentIds)과 출처(origin)는 손대지 못한다 — 그 둘은 AI 가 원문에서
 * 확인한 사실이고, 화면에서 보낸 값으로 바꿀 수 있으면 근거 없는 줄이 근거 있는 척을 한다.
 * 그래서 요청은 정리본 통째가 아니라 「이 자리의 글을 이것으로」 목록이다.
 *
 * 저장은 `digest-run.ts` 가 새 판으로 쌓는다 — 고친 것도 이전 판으로 돌아갈 수 있다.
 */

import type { DigestAgendaItem, DigestFact, DigestResult } from './digest.ts'

/** 한 칸에 받는 글자 상한. 정리본 한 줄은 길어야 수백 자다 */
export const MAX_EDIT_CHARS = 1_000
/** 한 번에 받는 고침 수 상한 */
export const MAX_EDITS = 500

export type DigestEditPath =
  | { kind: 'outcome' }
  | { kind: 'nextStep' }
  | { kind: 'agendaTitle'; agenda: number }
  | { kind: 'fact'; agenda: number; fact: number }
  | { kind: 'decision'; index: number }

export interface DigestEdit {
  path: DigestEditPath
  text: string
}

export type EditOutcome =
  | { ok: true; digest: DigestResult; changed: number }
  | { ok: false; reason: string }

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function parsePath(raw: unknown): DigestEditPath | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (o.kind === 'outcome' || o.kind === 'nextStep') return { kind: o.kind }
  if (o.kind === 'agendaTitle' && isIndex(o.agenda)) return { kind: 'agendaTitle', agenda: o.agenda }
  if (o.kind === 'fact' && isIndex(o.agenda) && isIndex(o.fact)) return { kind: 'fact', agenda: o.agenda, fact: o.fact }
  if (o.kind === 'decision' && isIndex(o.index)) return { kind: 'decision', index: o.index }
  return null
}

/** 요청 본문을 읽는다. 모양이 하나라도 틀리면 통째로 거절한다 — 반만 반영하면 사람이 본 화면과 다르다 */
export function parseDigestEdits(raw: unknown): { ok: true; edits: DigestEdit[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: '고친 내용이 없어요.' }
  if (raw.length > MAX_EDITS) return { ok: false, reason: '한 번에 고칠 수 있는 줄 수를 넘었어요.' }
  const edits: DigestEdit[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { ok: false, reason: '고친 내용을 읽지 못했어요.' }
    const rec = item as Record<string, unknown>
    const path = parsePath(rec.path)
    if (!path || typeof rec.text !== 'string') return { ok: false, reason: '고친 내용을 읽지 못했어요.' }
    if (rec.text.length > MAX_EDIT_CHARS) return { ok: false, reason: `한 줄은 ${MAX_EDIT_CHARS.toLocaleString()}자까지 쓸 수 있어요.` }
    edits.push({ path, text: rec.text })
  }
  return { ok: true, edits }
}

const keyOf = (p: DigestEditPath): string =>
  p.kind === 'agendaTitle' ? `t:${p.agenda}`
    : p.kind === 'fact' ? `f:${p.agenda}:${p.fact}`
      : p.kind === 'decision' ? `d:${p.index}`
        : p.kind

/** 고친 줄 하나. 글이 같으면 원래 것을 그대로 돌려준다 — 「사람」 표시는 실제로 바뀐 줄에만 */
function editFact(f: DigestFact, next: string | undefined): DigestFact | null {
  if (next === undefined) return f
  const text = next.trim()
  if (!text) return null
  if (text === f.text) return f
  return { ...f, text, edited: true }
}

/**
 * 기준 판에 고침을 얹어 새 정리본을 만든다. **기준 판은 건드리지 않는다.**
 *
 * - 사실이나 결정을 비우면 그 줄이 빠진다(지우기). 사실이 다 빠진 안건도 빠진다 — 읽기 쪽과 같은 규칙
 * - 안건 제목은 비울 수 없다
 * - 없는 자리를 가리키면 거절한다 — 화면이 본 판과 서버의 판이 다르다는 뜻이다
 */
export function applyDigestEdits(base: DigestResult, edits: DigestEdit[]): EditOutcome {
  const byKey = new Map<string, string>()
  for (const e of edits) {
    const p = e.path
    if (p.kind === 'agendaTitle' && !base.agenda[p.agenda]) return { ok: false, reason: '고치려는 줄을 찾지 못했어요.' }
    if (p.kind === 'fact' && !base.agenda[p.agenda]?.facts[p.fact]) return { ok: false, reason: '고치려는 줄을 찾지 못했어요.' }
    if (p.kind === 'decision' && !base.decisions[p.index]) return { ok: false, reason: '고치려는 줄을 찾지 못했어요.' }
    if (p.kind === 'agendaTitle' && !e.text.trim()) return { ok: false, reason: '안건 제목은 비울 수 없어요.' }
    byKey.set(keyOf(p), e.text)
  }

  let changed = 0
  const count = <T>(before: T, after: T | null): T | null => { if (after !== before) changed += 1; return after }

  const agenda: DigestAgendaItem[] = base.agenda.flatMap((a, i) => {
    const facts = a.facts
      .map((f, j) => count(f, editFact(f, byKey.get(`f:${i}:${j}`))))
      .filter((f): f is DigestFact => f !== null)
    if (facts.length === 0) return []
    const nextTitle = byKey.get(`t:${i}`)?.trim()
    if (!nextTitle || nextTitle === a.title) return [{ title: a.title, facts }]
    changed += 1
    return [{ title: nextTitle, facts }]
  })

  const decisions = base.decisions
    .map((d, i) => count(d, editFact(d, byKey.get(`d:${i}`))))
    .filter((d): d is DigestFact => d !== null)

  const line = (key: 'outcome' | 'nextStep'): string => {
    const next = byKey.get(key)
    if (next === undefined) return base[key]
    const text = next.trim()
    if (text !== base[key]) changed += 1
    return text
  }

  // 세기가 끝난 뒤에 changed 를 읽는다 — 객체 안에서 함께 부르면 이 둘이 세어지기 전에 읽힌다
  const outcome = line('outcome')
  const nextStep = line('nextStep')
  return { ok: true, changed, digest: { outcome, nextStep, agenda, decisions, conflicts: base.conflicts } }
}
