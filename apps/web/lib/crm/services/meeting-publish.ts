/**
 * 회의노트 → CRM 미팅 "발행" (통합 기획 §3, docs/2026-08-21-v0.7.572-crm-meeting-capture)
 *
 * **왜 이 파일이 생겼나**: 같은 회의를 두 곳이 각자 기록하고 있었다.
 *   · `/meeting-notes` (3,968줄) — 본문·요약·결정사항·참석자, 그리고 전사·오디오 자리까지 이미 있다
 *   · `/crm/meetings` (약 1,200줄) — 회사·딜·5축 제안
 * 원본을 두 벌로 두면 어느 쪽이 진실인지 아무도 모른다.
 * 그래서 **원본은 회의노트 하나**로 두고, CRM 은 그것을 "발행"받는다.
 *
 * **왜 참조가 아니라 스냅샷인가** (셋 다 실제로 깨지는 것들이다)
 *   ① 개인이 노트를 지우면 **팀의 영업 기록이 사라진다**
 *   ② 인박스 제안의 근거(segmentId)가 **원본 편집으로 깨진다**
 *   ③ 워크스페이스 격리(CRM)와 개인 소유(노트) RLS 를 **넘나드는 조회**가 생긴다
 * 스냅샷은 이 저장소가 이미 쓰는 개념이다 — 주간보고 `weekly_report_snapshots`.
 *
 * **발행은 공개 행위다.** 개인 노트가 팀에 보이게 되는 일이므로 자동으로 일어나지 않는다.
 * 남의 노트는 발행할 수 없다(아래 소유 확인).
 */

import { getCrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText } from '../domain/normalize.ts'
import { transcribe } from './meeting.ts'
import { pastedTranscriptAdapter } from '../stt/adapter.ts'
import { htmlToPlain } from '../../html-to-plain.ts'

/** 스냅샷 출처를 기록에 남긴다 — 사람이 붙여넣은 것과 구분할 수 있어야 한다 */
export const NOTE_SNAPSHOT_VENDOR = 'note-snapshot'

export interface PublishInput {
  noteId: string
  companyId?: string | null
  dealId?: string | null
}

export interface PublishResult {
  meetingId: string
  /** 이미 발행돼 있어서 새로 만들지 않았나 (멱등) */
  alreadyPublished: boolean
  /** 스냅샷으로 옮긴 전사 줄 수. 본문이 비었으면 0 */
  segmentCount: number
  /** 요약을 함께 가져왔나 */
  summaryCopied: boolean
}

/** 회의노트 한 행 — 발행에 필요한 것만 */
export interface NoteRow {
  id: string
  user_id: string
  title: string | null
  meeting_at: string | null
  created_at: string
  attendees: string[] | null
  attendee_user_ids: string[] | null
  body_html: string | null
  body_plain: string | null
  transcript: string | null
  summary: string | null
  decisions: string | null
  updated_at: string
}

const NOTE_COLUMNS =
  'id, user_id, title, meeting_at, created_at, attendees, attendee_user_ids, ' +
  'body_html, body_plain, transcript, summary, decisions, updated_at'

/**
 * 노트를 읽는다. **본인 것만.**
 *
 * service_role 로 읽으므로 RLS 를 우회한다 — 그래서 소유 확인을 코드가 명시로 한다.
 * 이걸 빼면 id 만 알면 남의 회의를 팀 CRM 에 올릴 수 있다.
 */
async function loadOwnNote(noteId: string, hostUserId: string): Promise<NoteRow> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select(NOTE_COLUMNS)
    .eq('id', noteId)
    .eq('user_id', hostUserId)
    .is('deleted_at', null)
    .maybeSingle()

  const note = data as NoteRow | null
  if (!note) throw new CrmError('NOT_FOUND', '회의노트를 찾을 수 없습니다.', { field: 'noteId' })
  return note
}

/**
 * 전사로 쓸 글을 고른다.
 *
 * 우선순위가 곧 정확도 순서다 — 기계가 받아 적은 전사가 가장 정확하고,
 * 없으면 사람이 쓴 본문을 쓴다. HTML 은 반드시 plain 으로 바꾼다(§5-1 텍스트 SSOT):
 * 안 그러면 `<br/>` 가 글자로 남아 AI 근거 인용에 그대로 나온다.
 */
export function pickTranscriptSource(note: Pick<NoteRow, 'transcript' | 'body_plain' | 'body_html'>): string {
  const t = (note.transcript ?? '').trim()
  if (t) return t
  const plain = (note.body_plain ?? '').trim()
  if (plain) return plain
  return htmlToPlain(note.body_html ?? '').trim()
}

/**
 * 요약 스냅샷.
 *
 * **이것이 F-1(죽은 배선)의 해소다.** `crm_meeting.summaryMd` 는 읽는 곳이 6군데인데
 * **쓰는 코드가 0곳**이었다 — 목록 배지는 영원히 '전사 대기'였고, 단계 점검 AI·다음 행동 AI 는
 * 미팅 요약을 언제나 null 로 받았다. 새로 만들 필요가 없다. 회의노트에 이미 있는 것을 가져오면 된다.
 */
export function composeSummary(note: Pick<NoteRow, 'summary' | 'decisions'>): string | null {
  const summary = (note.summary ?? '').trim()
  const decisions = (note.decisions ?? '').trim()
  if (!summary && !decisions) return null
  const parts: string[] = []
  if (summary) parts.push(summary)
  if (decisions) parts.push(`## 결정사항\n\n${decisions}`)
  return parts.join('\n\n')
}

/** 노트 참석자 → CRM attendeesJson. 내부 조직원은 CrmMember 로 옮겨 담는다 */
async function composeAttendees(
  workspaceId: string,
  note: NoteRow,
): Promise<{ memberIds: string[]; personIds: string[]; externalNames: string[] }> {
  const names = (note.attendees ?? []).map((n) => n.trim()).filter(Boolean)
  const uids = (note.attendee_user_ids ?? []).filter(Boolean)
  if (uids.length === 0) return { memberIds: [], personIds: [], externalNames: names }

  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = await (db as any).crmMember.findMany({
    where: { hostUserId: { in: uids }, deletedAt: null },
    select: { id: true },
  }) as { id: string }[]

  return { memberIds: members.map((m) => m.id), personIds: [], externalNames: names }
}

/** 이 노트로 이미 만든 미팅이 있나 — 발행을 두 번 눌러도 두 벌이 생기지 않게 */
async function findPublished(workspaceId: string, noteId: string): Promise<{ id: string } | null> {
  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmMeeting.findFirst({
    where: { noteId, deletedAt: null },
    select: { id: true },
  })
}

/**
 * 발행 — 회의노트를 CRM 미팅으로 올린다.
 *
 * 두 번 눌러도 안전하다(멱등). 이미 있으면 그 미팅을 돌려준다 —
 * 새로 만들면 같은 회의가 딜에 두 번 걸리고, 5축 제안도 두 벌이 된다.
 */
export async function publishFromNote(
  workspaceId: string,
  actorId: string | null,
  hostUserId: string,
  input: PublishInput,
): Promise<PublishResult> {
  const note = await loadOwnNote(input.noteId, hostUserId)

  const existing = await findPublished(workspaceId, input.noteId)
  if (existing) {
    return { meetingId: existing.id, alreadyPublished: true, segmentCount: 0, summaryCopied: false }
  }

  // 회의 시각이 비어 있을 수 있다(노트는 nullable). 그때는 만든 날을 쓴다 —
  // 시각 없는 미팅은 CRM 이 못 받고, 그렇다고 발행을 막으면 기록이 영영 안 넘어온다.
  const startedAt = new Date(note.meeting_at ?? note.created_at)
  if (Number.isNaN(startedAt.getTime())) {
    throw new CrmError('VALIDATION_FAILED', '회의 시각을 읽을 수 없습니다. 회의노트에서 일시를 먼저 정해 주세요.')
  }

  const title = normalizeText(note.title) ?? '(제목 없음)'
  const summaryMd = composeSummary(note)
  const attendeesJson = await composeAttendees(workspaceId, note)

  const created = await withCrmTx(workspaceId, async (tx) => {
    // 회사·딜 실재 확인 — 이 관계에는 FK 가 없어 DB 가 안 막아 준다(createMeeting 과 같은 이유)
    if (input.companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const co = await (tx as any).crmCompany.findFirst({ where: { id: input.companyId }, select: { id: true } })
      if (!co) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.', { field: 'companyId' })
    }
    if (input.dealId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await (tx as any).crmDeal.findFirst({ where: { id: input.dealId }, select: { id: true } })
      if (!d) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.', { field: 'dealId' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await (tx as any).crmMeeting.create({
      data: {
        title,
        startedAt,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        summaryMd,
        attendeesJson,
        noteId: note.id,
        noteSyncedAt: new Date(note.updated_at),
        createdById: actorId,
        // 사람이 쓴 것을 옮겨 온 것이라 HUMAN 이다. AI 가 만든 값이 아니다.
        source: 'HUMAN',
      },
      select: { id: true },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.published_from_note',
      targetType: 'meeting', targetId: m.id,
      afterJson: { noteId: note.id, title, hasSummary: Boolean(summaryMd) },
    })
    return m as { id: string }
  })

  // 전사 스냅샷 — 기존 `transcribe()` 를 그대로 부른다(상태 전이·감사로그가 이미 그 안에 있다).
  // 본문이 비어 있으면 넘어간다. 빈 전사로 실패시키면 "회의는 했는데 아직 안 적은" 노트를 못 올린다.
  let segmentCount = 0
  const source = pickTranscriptSource(note)
  if (source) {
    const res = await transcribe(
      workspaceId, actorId, created.id,
      pastedTranscriptAdapter(source, NOTE_SNAPSHOT_VENDOR),
      `meeting_notes/${note.id}`,
    )
    segmentCount = res.segmentCount
  }

  return {
    meetingId: created.id,
    alreadyPublished: false,
    segmentCount,
    summaryCopied: Boolean(summaryMd),
  }
}

export interface ResyncResult {
  meetingId: string
  segmentCount: number
  summaryCopied: boolean
  /** 이번 재동기화로 거둬들인 미처리 제안 수 */
  expiredSuggestions: number
}

/**
 * 다시 가져오기 — 원본이 바뀌었을 때.
 *
 * **조용히 어긋나게 두지 않는다.** 노트의 `updated_at` 이 `noteSyncedAt` 보다 크면
 * 화면이 "원본이 그 뒤 수정됐어요"라고 말하고, 이 함수가 그것을 따라잡는다.
 *
 * 옛 제안은 거둔다 — 바뀐 원본에서 나오지 않은 제안이 인박스에 남아 있으면
 * 사람이 그걸 반영하는 순간 **없어진 내용**이 CRM 에 들어간다.
 * 단 사람이 이미 판단한 것(ACCEPTED·REJECTED)은 건드리지 않는다 — 그건 사실로 일어난 일이다.
 * (`deleteMeeting` 이 쓰는 규칙과 같다. 두 벌로 만들지 않는다.)
 */
export async function resyncFromNote(
  workspaceId: string,
  actorId: string | null,
  hostUserId: string,
  meetingId: string,
): Promise<ResyncResult> {
  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { id: meetingId, deletedAt: null },
    select: { id: true, noteId: true },
  }) as { id: string; noteId: string | null } | null
  if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')
  if (!meeting.noteId) {
    throw new CrmError('VALIDATION_FAILED', '이 미팅은 회의노트에서 온 것이 아닙니다.')
  }

  const note = await loadOwnNote(meeting.noteId, hostUserId)
  const summaryMd = composeSummary(note)
  const attendeesJson = await composeAttendees(workspaceId, note)

  const expiredSuggestions = await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeeting.updateMany({
      where: { id: meetingId },
      data: {
        title: normalizeText(note.title) ?? '(제목 없음)',
        summaryMd,
        attendeesJson,
        noteSyncedAt: new Date(note.updated_at),
      },
    })

    // 옛 전사 스냅샷을 치운다 — 새 것을 그 위에 얹으면 같은 말이 두 번 남는다.
    // 세그먼트는 recording 에 CASCADE 로 매달려 있어 recording 만 지우면 함께 간다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeetingRecording.deleteMany({
      where: { meetingId, sttVendor: NOTE_SNAPSHOT_VENDOR },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runs = await (tx as any).crmAiRun.findMany({
      where: { kind: 'MEETING_EXTRACT', inputRef: { path: ['meetingId'], equals: meetingId } },
      select: { id: true },
    }) as { id: string }[]
    let expired = 0
    if (runs.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (tx as any).crmAiSuggestion.updateMany({
        where: { runId: { in: runs.map((x) => x.id) }, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      })
      expired = r.count
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.resynced_from_note',
      targetType: 'meeting', targetId: meetingId,
      afterJson: { noteId: note.id, expiredSuggestions: expired },
    })
    return expired
  })

  let segmentCount = 0
  const source = pickTranscriptSource(note)
  if (source) {
    const res = await transcribe(
      workspaceId, actorId, meetingId,
      pastedTranscriptAdapter(source, NOTE_SNAPSHOT_VENDOR),
      `meeting_notes/${note.id}`,
    )
    segmentCount = res.segmentCount
  }

  return { meetingId, segmentCount, summaryCopied: Boolean(summaryMd), expiredSuggestions }
}

/**
 * 발행 취소 — 연결만 끊는다.
 *
 * **미팅을 지우지 않는다.** 되돌릴 수 있어야 사람이 부담 없이 발행한다.
 * 스냅샷과 이미 반영된 제안은 그대로 남는다 — 그건 팀이 이미 본 사실이다.
 */
export async function unpublishNote(
  workspaceId: string,
  actorId: string | null,
  meetingId: string,
): Promise<{ meetingId: string }> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmMeeting.findFirst({
      where: { id: meetingId, deletedAt: null },
      select: { id: true, noteId: true },
    }) as { id: string; noteId: string | null } | null
    if (!before) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')
    if (!before.noteId) throw new CrmError('VALIDATION_FAILED', '연결된 회의노트가 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeeting.updateMany({
      where: { id: meetingId },
      data: { noteId: null, noteSyncedAt: null },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.unpublished',
      targetType: 'meeting', targetId: meetingId,
      beforeJson: { noteId: before.noteId },
    })
    return { meetingId }
  })
}

export interface CreateWithNoteInput {
  title: string
  startedAt: string
  companyId?: string | null
  dealId?: string | null
  location?: string | null
}

/**
 * CRM 에서 미팅을 만들면 **회의노트도 함께 생긴다** (사용자 결정 D5).
 *
 * 왜: 원본은 회의노트 하나라고 정해 놓고 CRM 에서 시작하면 원본이 없는 미팅이 생긴다.
 * 그러면 같은 회의가 또 두 벌이 된다 — 이 기획이 없애려던 바로 그 상태다.
 *
 * 두 가지를 코드가 정한다.
 *   · `status='draft'` — 개인 회의노트 목록을 어지럽히지 않는다. 내용을 채우면 사람이 확정한다
 *   · `visibility='crm'` — **여기서 만든 것은 기본 공개다**(D6 원문: "미팅에서 생성하면 기본으로 공개").
 *     회의노트에서 만들면 컬럼 기본값 'private' 이 된다 — 출처에 따라 기본값이 다른 게 핵심이다
 *
 * 노트를 못 만들면 **미팅도 만들지 않는다.** 반쪽만 생기면 화면이 "원본 없음"을 띄우는데
 * 사용자는 방금 만든 것이라 이유를 알 수 없다.
 */
export async function createMeetingWithNote(
  workspaceId: string,
  actorId: string | null,
  hostUserId: string,
  input: CreateWithNoteInput,
): Promise<{ id: string; noteId: string }> {
  const started = new Date(input.startedAt)
  if (Number.isNaN(started.getTime())) {
    throw new CrmError('VALIDATION_FAILED', '미팅 시각을 다시 확인해 주세요.', { field: 'startedAt' })
  }
  const title = normalizeText(input.title) ?? '(제목 없음)'

  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('meeting_notes')
    .insert({
      user_id: hostUserId,
      title,
      meeting_at: started.toISOString(),
      status: 'draft',
      visibility: 'crm',
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new CrmError('CONFLICT', '회의노트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  const noteId = data.id as string

  const created = await withCrmTx(workspaceId, async (tx) => {
    if (input.companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const co = await (tx as any).crmCompany.findFirst({ where: { id: input.companyId }, select: { id: true } })
      if (!co) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.', { field: 'companyId' })
    }
    if (input.dealId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await (tx as any).crmDeal.findFirst({ where: { id: input.dealId }, select: { id: true } })
      if (!d) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.', { field: 'dealId' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await (tx as any).crmMeeting.create({
      data: {
        title,
        startedAt: started,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        location: normalizeText(input.location),
        noteId,
        noteSyncedAt: new Date(),
        createdById: actorId,
        source: 'HUMAN',
      },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.created_with_note',
      targetType: 'meeting', targetId: m.id, afterJson: { noteId, title },
    })
    return m as { id: string }
  })

  return { id: created.id, noteId }
}

export interface PickableNote {
  id: string
  title: string | null
  meetingAt: string | null
  /** 이미 CRM 에 올라간 노트인가 — 목록에서 회색으로 보여 준다(숨기면 "왜 없지"가 된다) */
  published: boolean
}

/**
 * "회의노트에서 가져오기" 목록 — 내 노트만.
 *
 * 이미 올린 것을 **숨기지 않는다.** 숨기면 사용자는 "분명 있었는데"를 겪는다.
 * 대신 표시해 두고 고르면 기존 미팅으로 데려간다(발행이 멱등이라 그렇게 된다).
 */
export async function listMyNotesForPicker(
  workspaceId: string,
  hostUserId: string,
  opts: { q?: string; limit?: number } = {},
): Promise<PickableNote[]> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let query = admin
    .from('meeting_notes')
    .select('id, title, meeting_at')
    .eq('user_id', hostUserId)
    .is('deleted_at', null)
    .order('meeting_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(opts.limit ?? 20, 50))
  const q = (opts.q ?? '').trim()
  if (q) query = query.ilike('title', `%${q}%`)

  const { data } = await query
  const rows = (data ?? []) as { id: string; title: string | null; meeting_at: string | null }[]
  if (rows.length === 0) return []

  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const published = await (db as any).crmMeeting.findMany({
    where: { noteId: { in: rows.map((r) => r.id) }, deletedAt: null },
    select: { noteId: true },
  }) as { noteId: string | null }[]
  const publishedSet = new Set(published.map((p) => p.noteId).filter(Boolean) as string[])

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    meetingAt: r.meeting_at,
    published: publishedSet.has(r.id),
  }))
}

export interface NoteMeta {
  id: string
  /** 원본이 아직 살아 있나 (소프트 삭제도 없는 것으로 본다) */
  exists: boolean
  title: string | null
  updatedAt: string | null
  visibility: 'private' | 'crm' | null
  /** 이 사람이 원본을 열어 볼 수 있나 — 본인이거나, 공개(crm)로 열어 뒀거나 */
  canOpen: boolean
  /**
   * 이 사람이 원본을 **고칠** 수 있나 — 작성한 사람뿐이다.
   * 읽기 공개(crm)와 편집 권한은 다른 명제다(마이그 216 주석).
   * CRM 화면의 작업대가 편집기를 그릴지 읽기로 그릴지를 이 값으로 정한다.
   */
  isOwner: boolean
  /** 원본이 스냅샷보다 새로운가 */
  isStale: boolean
}

/**
 * CRM 미팅 화면이 원본 상태를 알기 위해 읽는다.
 *
 * **본문을 주지 않는다.** 여기서 주는 건 "살아 있나 / 언제 바뀌었나 / 열어도 되나"뿐이다.
 * 본문은 CRM 이 이미 스냅샷으로 갖고 있고, 공개 범위(D6)를 넘어 본문을 흘리면
 * `private` 로 둔 사람의 기대가 깨진다.
 *
 * `canOpen` 이 false 여도 화면은 정상이다 — 스냅샷을 보여주고 링크만 안 그린다.
 * 이게 스냅샷 구조라서 가능한 일이다(참조만 했다면 화면이 통째로 비었을 것이다).
 */
export async function loadNoteMeta(
  noteId: string,
  hostUserId: string,
  noteSyncedAt: string | Date | null | undefined,
): Promise<NoteMeta> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('id, user_id, title, updated_at, visibility, deleted_at')
    .eq('id', noteId)
    .maybeSingle()

  const row = data as {
    id: string; user_id: string; title: string | null
    updated_at: string; visibility: string | null; deleted_at: string | null
  } | null

  if (!row || row.deleted_at) {
    // 지워진 원본도 "없다"고 정직하게 말한다 — 화면이 "원본 없음"을 띄울 수 있어야 한다
    return { id: noteId, exists: false, title: null, updatedAt: null, visibility: null, canOpen: false, isOwner: false, isStale: false }
  }

  const visibility = row.visibility === 'crm' ? 'crm' : 'private'
  return {
    id: row.id,
    exists: true,
    title: row.title,
    updatedAt: row.updated_at,
    visibility,
    // 워크스페이스 멤버십은 CRM 세션이 이미 보장한다. 여기서는 공개 범위만 본다.
    canOpen: row.user_id === hostUserId || visibility === 'crm',
    isOwner: row.user_id === hostUserId,
    isStale: isNoteNewerThanSnapshot(row.updated_at, noteSyncedAt ?? null),
  }
}

/**
 * 원본이 스냅샷보다 새로운가 — 화면이 "다시 가져오기"를 띄울지 판단한다.
 *
 * 순수 함수로 뺀 이유: 이 판정이 틀리면 배지가 영원히 뜨거나 영원히 안 뜬다.
 * 컴포넌트 안에 두면 실브라우저 말고는 검증할 방법이 없다(완료 조건 E-6).
 */
export function isNoteNewerThanSnapshot(
  noteUpdatedAt: string | Date | null | undefined,
  noteSyncedAt: string | Date | null | undefined,
): boolean {
  if (!noteUpdatedAt || !noteSyncedAt) return false
  const updated = new Date(noteUpdatedAt).getTime()
  const synced = new Date(noteSyncedAt).getTime()
  if (Number.isNaN(updated) || Number.isNaN(synced)) return false
  // 같은 시각은 "안 바뀐 것"이다. 발행 직후 배지가 뜨면 아무도 안 믿는다.
  return updated > synced
}
