/**
 * 회의 옆 패널 — 순수 계산.
 *
 * 사용자 지적(2026-10-21): 녹음하며 다른 미팅 기록을 보려면 새 탭을 열어야 했다.
 * 회의 화면을 그대로 둔 채 옆에서 할 일 둘(다른 기록 보기, 이 회의에 묻기)을 한 패널에 둔다.
 *
 * 패널이 열렸는지와 어느 탭인지는 주소가 쥔다(`?side=`) — 뒤로 가기로 닫히고 새로고침해도 남는다.
 */

import { escapeHtml } from '../ai-chat/export.ts'

export const SIDE_PARAM = 'side'
/** 연 기록 — 뒤로 가기로 목록으로 돌아온다 */
export const PEEK_PARAM = 'peek'

export type SideTab = 'records' | 'ask'
export const SIDE_TABS: SideTab[] = ['records', 'ask']

export function parseSideTab(v: string | null | undefined): SideTab | null {
  return v === 'records' || v === 'ask' ? v : null
}

/** 회의노트 목록에서 온 한 줄 (`listMeetingNotes`) */
export interface NoteRow {
  id: string
  title: string | null
  meeting_at: string | null
  created_at: string
  summary: string | null
}

/** CRM 미팅 목록에서 온 한 줄 — 회사를 안다 */
export interface CrmMeetingRow {
  id: string
  title: string
  startedAt: string
  companyId: string | null
  companyName?: string | null
  summaryMd: string | null
  noteId: string | null
}

export interface OtherRecord {
  key: string
  /** 원본 회의노트. 있으면 그 정리를 읽기 전용으로 띄운다 */
  noteId: string | null
  title: string
  at: string
  companyName: string | null
  sameCompany: boolean
  /** 원본이 없을 때 띄울 요약 */
  summary: string | null
}

export interface OrderInput {
  notes: NoteRow[]
  crmMeetings: CrmMeetingRow[]
  currentNoteId: string
  /** 지금 회의가 걸린 회사. 모르면 null */
  companyId: string | null
  /**
   * 회의 모드 — 고객 앞에서 노트북을 펼친 상태(`lib/crm/ui/meeting-mode`).
   * 다른 회사 이름과 내용이 상대에게 보이지 않게 같은 회사 기록만 남긴다.
   */
  meetingMode: boolean
}

const time = (s: string): number => {
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

/**
 * 옆 패널의 다른 기록 목록. **같은 회사가 먼저, 그 안에서는 최근 것이 먼저.**
 *
 * - 지금 회의는 빠진다 — 자기 자신을 옆에 띄울 이유가 없다
 * - CRM 미팅과 회의노트가 같은 원본을 가리키면 한 줄만 둔다(CRM 쪽이 회사를 알아 그쪽을 남긴다)
 */
export function orderOtherRecords(input: OrderInput): OtherRecord[] {
  const seen = new Set<string>([input.currentNoteId])
  const out: OtherRecord[] = []

  for (const m of input.crmMeetings) {
    if (m.noteId && seen.has(m.noteId)) continue
    if (m.noteId) seen.add(m.noteId)
    out.push({
      key: `crm:${m.id}`,
      noteId: m.noteId,
      title: m.title,
      at: m.startedAt,
      companyName: m.companyName ?? null,
      sameCompany: Boolean(input.companyId && m.companyId === input.companyId),
      summary: m.summaryMd,
    })
  }
  for (const n of input.notes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push({
      key: `note:${n.id}`,
      noteId: n.id,
      title: n.title?.trim() || '제목 없는 회의',
      at: n.meeting_at ?? n.created_at,
      companyName: null,
      sameCompany: false,
      summary: n.summary,
    })
  }

  const kept = input.meetingMode ? out.filter((r) => r.sameCompany) : out
  return [...kept].sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany) || time(b.at) - time(a.at))
}

/** 요약 평문을 한 줄씩 — 원본 없는 기록에서 「메모에 붙이기」를 줄마다 달기 위해 */
export function summaryLines(summary: string | null): string[] {
  return (summary ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•]\s*/, '').trim())
    .filter((l) => l && !/^\[.*\]$/.test(l))
}

/**
 * 지금 메모 끝에 한 줄을 붙인다. 글은 사람이 읽은 다른 기록의 문장이라 마크업으로 읽히면 안 된다.
 * Tiptap 은 빈 글에도 `<p></p>` 를 남기므로 그 자리를 채운다.
 */
export function appendParagraph(html: string, text: string): string {
  const line = `<p>${escapeHtml(text.trim())}</p>`
  const base = html.trim()
  if (!base || base === '<p></p>') return line
  return base + line
}
