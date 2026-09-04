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
import { transcribe, deleteMeeting } from './meeting.ts'
import { pastedTranscriptAdapter } from '../stt/adapter.ts'
import { htmlToPlain } from '../../html-to-plain.ts'
import { NOTE_VISIBILITY } from '../../meeting/note-visibility.ts'
import {
  readShareState, planShareState, type MeetingShareState,
} from '../../meeting/share-state.ts'

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
/**
 * 노트를 읽는다. **볼 수 있는 사람이면.** (주인 이거나 팀 공개)
 *
 * `loadOwnNote` 와 나란히 두는 이유: 둘의 경계가 다르다.
 *   · `loadOwnNote` — **고치는** 일(발행·재동기화)의 경계. 주인만.
 *   · 이 함수 — **읽는** 일(AI 재료)의 경계. 화면에서 볼 수 있는 사람과 같다.
 * 못 읽으면 던지지 않고 null 이다 — 부르는 쪽이 「읽을 것이 없다」로 이어 가면 된다.
 */
async function loadReadableNote(noteId: string, hostUserId: string): Promise<NoteRow | null> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select(`${NOTE_COLUMNS}, visibility`)
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()

  const note = data as (NoteRow & { visibility: string | null }) | null
  if (!note) return null
  const canOpen = note.user_id === hostUserId || note.visibility === NOTE_VISIBILITY.CRM
  return canOpen ? note : null
}

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
    /**
     * **제목은 덮지 않는다.**
     *
     * 예전엔 여기서 `title` 을 노트 제목으로 되썼다. 그래서 CRM 에서 「8/31 김해사업 미팅」으로
     * 고쳐 둔 미팅이 「다시 가져오기」 한 번에 「8/31 미팅」으로 되돌아갔다.
     * 「정리」 탭을 쓰기만 해도 같은 일이 일어났다 — 정리가 끝나면 화면이 스스로 이 함수를 부른다.
     * (사용자 지적 2026-08-31: 「제목부터가 다르고 … 일관성이 없다」)
     *
     * 원칙: **사람이 손으로 넣은 값은 기계가 덮지 않는다.** 따라잡을 것은 파생값뿐이다 —
     * 요약·참석자·전사. 제목을 한 벌로 만드는 일은 «고치는 자리»를 하나로 모아서 한다
     * (`PATCH /api/crm/meetings/:id` 가 원본 제목을 함께 고친다).
     */
    await (tx as any).crmMeeting.updateMany({
      where: { id: meetingId },
      data: {
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
 * 발행 취소 — **원본을 잠근다. 링크는 끊지 않는다.**
 *
 * ## 예전에 무엇을 했고 왜 바꿨나
 *
 * 예전엔 `noteId = null` 을 했다. "연결만 끊고 기록은 남긴다"는 뜻이었는데
 * 두 가지가 어긋났다(사용자 지적 2026-08-24: *"연결 해제와 연결이 의미가 있나?"*).
 *
 *   ① 사용자가 기대한 것과 반대였다 — 미팅도 요약도 전사도 팀에 **그대로 남았다.**
 *      "해제"라는 말이 약속하는 것을 하나도 하지 않았다.
 *   ② 재발행의 멱등 판정이 그 `noteId` 로 기존 미팅을 찾는다(`findPublished`).
 *      지워 버리니 못 찾아서 **같은 회의가 CRM 에 두 벌** 생겼다 —
 *      v0.7.576 이 없애려던 바로 그 상태다.
 *
 * 지금은 같은 목적("기록은 남기고 원본은 닫는다")을 링크가 아니라 **읽기 범위**로 이룬다.
 * 그것이 손잡이 SSOT 의 `RECORD_ONLY` 다.
 *
 * @deprecated 새 코드는 `setNoteShareState` 를 부른다. 이 함수는 옛 라우트의 하위호환이다.
 */
export async function unpublishNote(
  workspaceId: string,
  actorId: string | null,
  meetingId: string,
): Promise<{ meetingId: string }> {
  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const before = await (db as any).crmMeeting.findFirst({
    where: { id: meetingId, deletedAt: null },
    select: { id: true, noteId: true, createdById: true },
  }) as { id: string; noteId: string | null; createdById: string | null } | null
  if (!before) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')
  if (!before.noteId) throw new CrmError('VALIDATION_FAILED', '연결된 회의노트가 없습니다.')

  // 원본 주인만 읽기 범위를 바꿀 수 있다 — 그 판정은 SSOT 안에 있다
  const { hostUserId } = await resolveNoteOwner(before.noteId)
  await setNoteShareState(workspaceId, actorId, hostUserId, {
    noteId: before.noteId,
    next: 'RECORD_ONLY',
  })
  return { meetingId }
}

/**
 * 회의노트의 주인을 찾는다.
 *
 * 옛 `/unpublish` 라우트는 미팅 id 만 준다. 읽기 범위를 바꾸려면 원본 주인이 필요한데,
 * 그 정보가 요청에 없다. 여기서 한 번 찾아 새 SSOT 로 넘긴다 —
 * 라우트를 고치지 않고도 동작을 통일할 수 있게 한다(M-4 추가 전용).
 */
async function resolveNoteOwner(noteId: string): Promise<{ hostUserId: string }> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('user_id')
    .eq('id', noteId)
    .maybeSingle()
  const row = data as { user_id: string } | null
  if (!row) throw new CrmError('NOT_FOUND', '회의노트를 찾을 수 없습니다.')
  return { hostUserId: row.user_id }
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
    /**
     * `updated_at` 도 함께 받는다 — 스냅샷 시각을 **DB 시계로** 찍기 위해서다.
     *
     * 실측(v0.7.595): 앱 서버 시계로 `new Date()` 를 찍었더니 DB 시계와 2초 어긋나
     * 방금 만든 빈 미팅에도 "원본 회의노트가 …에 수정됐어요"가 **항상** 떴다.
     * 노트는 한 번도 수정된 적이 없었다(created_at == updated_at). 시계 오차가
     * 그대로 "수정됨"으로 읽힌 것이다. 발행·재동기화는 원래 `note.updated_at` 을
     * 쓰고 있었는데 여기만 갈려 있었다(§재사용·단일구현).
     */
    .select('id, updated_at')
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
        // 같은 시계의 같은 값이라 절대 어긋나지 않는다 — 위 select 주석 참조
        noteSyncedAt: new Date(data.updated_at as string),
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
    .select('id, title, meeting_at, visibility')
    .eq('user_id', hostUserId)
    .is('deleted_at', null)
    .order('meeting_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(opts.limit ?? 20, 50))
  const q = (opts.q ?? '').trim()
  if (q) query = query.ilike('title', `%${q}%`)

  const { data } = await query
  const rows = (data ?? []) as { id: string; title: string | null; meeting_at: string | null; visibility: string | null }[]
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
    /**
     * 이 노트가 팀에게 어디까지 보이나 — 목록이 배지를 그리는 데 쓴다.
     * 왜 함께 주나(사용자 지적 v0.7.686): *"내가 쓴거니깐 두개 동시에 보이고
     * 현재 공개 상태만 표시 해주면 되는거 아냐?"* — 목록이 이 값을 건당 다시 물으면
     * 노트 수만큼 왕복이 생긴다(N+1).
     */
    shareState: readShareState({ hasLiveMeeting: publishedSet.has(r.id), hasNoteLink: true, visibility: r.visibility === NOTE_VISIBILITY.CRM ? NOTE_VISIBILITY.CRM : NOTE_VISIBILITY.PRIVATE }),
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
  /**
   * 원본에 사람이 쓴 본문이 있나.
   *
   * **본문을 주는 것이 아니다** — 있는지 없는지만 준다. 화면이 「AI로 정리하기」를 켤지,
   * 「전사를 먼저 넣어 주세요」라고 말할지 정하는 데 쓴다.
   * 예전엔 이 값이 없어서 CRM 이 전사 사본(비어 있음)만 보고 «읽을 것이 없다»고 답했다 —
   * 사용자가 쓴 193자가 원본에 그대로 있는데도(사용자 지적 2026-08-31).
   */
  hasBody: boolean
  /** 원본 제목 — CRM 제목과 어긋났는지 화면이 스스로 판단할 수 있게 */
  titleMatches: boolean | null
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
  /** 지금 CRM 이 들고 있는 제목. 주면 어긋났는지 함께 판정한다 */
  meetingTitle?: string,
): Promise<NoteMeta> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('id, user_id, title, body_plain, updated_at, visibility, deleted_at')
    .eq('id', noteId)
    .maybeSingle()

  const row = data as {
    id: string; user_id: string; title: string | null; body_plain: string | null
    updated_at: string; visibility: string | null; deleted_at: string | null
  } | null

  if (!row || row.deleted_at) {
    // 지워진 원본도 "없다"고 정직하게 말한다 — 화면이 "원본 없음"을 띄울 수 있어야 한다
    return {
      id: noteId, exists: false, title: null, updatedAt: null, visibility: null,
      canOpen: false, isOwner: false, isStale: false, hasBody: false, titleMatches: null,
    }
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
    hasBody: Boolean((row.body_plain ?? '').trim()),
    // 비교는 서버가 한다 — 화면마다 정규화 규칙이 갈리면 같은 상태가 다르게 읽힌다
    titleMatches: meetingTitle === undefined
      ? null
      : (normalizeText(row.title) ?? '') === (normalizeText(meetingTitle) ?? ''),
  }
}

/** 노트 화면이 보여 줄 «영업 CRM 쪽 사실» — 이름만, 한 건만 */
export interface NoteCrmFacts {
  meetingId: string
  companyId: string | null
  companyName: string | null
  dealId: string | null
  dealName: string | null
  location: string | null
}

/**
 * 이 회의노트에 붙은 **CRM 미팅 한 건**의 회사·딜·장소. `loadNoteMeta` 의 반대 방향이다.
 *
 * ## 왜 필요한가 (사용자 지적 2026-08-31)
 * 같은 회의인데 CRM 은 「코나아이 · 코나아이 회의실」을 알고, 회의노트는 몰랐다.
 * 노트 상세에 회사·딜·장소를 그리는 코드가 **0줄**이었다. 그래서 두 화면이 같은 회의를
 * 두고 다른 사실을 말했다 — 「일관성이 없다」의 한 축이 이것이다.
 *
 * ## 왜 이렇게 좁은가
 * 회의노트는 **개인 소유**(RLS `user_id`)이고 CRM 은 **워크스페이스 격리**다.
 * 이 경계를 넘는 조회가 원래 «스냅샷 구조»를 만든 이유 ③이었다. 그래서 창구를 최소로 연다:
 *   · **내 노트**에 붙은 **한 건**만 — 목록·검색·집계는 열지 않는다
 *   · **이름만** — 금액·단계·인물 같은 것은 주지 않는다
 * CRM 멤버가 아니면 `null` 이다. 화면은 그냥 패널을 안 그린다(오류가 아니다).
 */
export async function loadCrmFactsForNote(
  noteId: string,
  hostUserId: string,
): Promise<NoteCrmFacts | null> {
  try {
    const { resolveCrmAccessForUser } = await import('../auth/requireCrmMember.ts')
    const access = await resolveCrmAccessForUser(hostUserId)
    if (!access.ok) return null

    const db = getCrmDb(access.session.workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meeting = await (db as any).crmMeeting.findFirst({
      where: { noteId, deletedAt: null },
      select: { id: true, companyId: true, dealId: true, location: true },
    }) as {
      id: string; companyId: string | null; dealId: string | null; location: string | null
    } | null
    if (!meeting) return null

    // 이름은 각각 한 번씩만 — 없으면 null 로 둔다(지어내지 않는다)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const company = meeting.companyId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (db as any).crmCompany.findFirst({ where: { id: meeting.companyId }, select: { name: true } })
      : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deal = meeting.dealId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (db as any).crmDeal.findFirst({ where: { id: meeting.dealId }, select: { name: true } })
      : null

    return {
      meetingId: meeting.id,
      companyId: meeting.companyId,
      companyName: (company?.name as string | undefined) ?? null,
      dealId: meeting.dealId,
      dealName: (deal?.name as string | undefined) ?? null,
      location: meeting.location,
    }
  } catch {
    // 부가 정보다. 못 읽었다고 회의노트 화면이 통째로 안 뜨면 그게 더 큰 사고다
    return null
  }
}

/**
 * 읽을 것이 없으면 **원본 본문을 전사 재료로 끌어온다.** 추출 직전에 부른다.
 *
 * ## 왜 필요한가 (사용자 지적 2026-08-31)
 * 「AI가 찾은 것」이 「전사를 먼저 넣어 주세요」라고 답했다. 그런데 사용자가 쓴 193자는
 * 원본 회의노트에 그대로 있었다. AI 는 `crm_transcript_segment`(발행 때만 채워지는 사본)만
 * 보고 있었고, 그 표는 비어 있었다 — **발행 시점에는 본문이 없었기 때문이다.**
 * 사용자는 그 뒤에 썼다. 화면은 「다시 가져오기」를 띄웠지만, 그것을 누르면 제목이 파괴됐다.
 *
 * ## 새 기계장치를 만들지 않는다
 * 본문을 전사 재료로 바꾸는 코드는 이미 있다 — `pickTranscriptSource`(전사→본문 우선순위) +
 * `pastedTranscriptAdapter`(줄을 세그먼트로). 발행·재동기화가 쓰는 그 경로를 그대로 부른다.
 * 그래서 **AI 입력 경로가 두 벌이 되지 않는다.**
 *
 * ## 절대 막지 않는다
 * 여기서 실패해도 추출은 그대로 진행한다(0 을 돌려준다). 재료를 못 구한 것은
 * 추출이 「읽을 것이 없다」고 답할 이유이지, 사용자에게 오류를 띄울 이유가 아니다.
 *
 * @returns 새로 넣은 전사 줄 수. 이미 읽을 것이 있거나 본문이 비었으면 0
 */
export async function snapshotNoteBodyForExtract(
  workspaceId: string,
  actorId: string | null,
  hostUserId: string,
  meetingId: string,
): Promise<number> {
  try {
    const db = getCrmDb(workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meeting = await (db as any).crmMeeting.findFirst({
      where: { id: meetingId, deletedAt: null },
      select: { id: true, noteId: true },
    }) as { id: string; noteId: string | null } | null
    if (!meeting?.noteId) return 0

    /**
     * 이미 읽을 것이 있으면 손대지 않는다.
     * 사람이 붙여넣은 전사를 본문으로 덮으면 그게 곧 유실이다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any).crmMeetingRecording.findFirst({
      where: { meetingId, status: 'TRANSCRIBED' },
      select: { id: true },
    })
    if (existing) return 0

    /**
     * **화면에서 볼 수 있는 사람이면 AI 도 읽는다.**
     *
     * `loadNoteMeta.canOpen` 과 같은 규칙이다 — 주인이거나 팀 공개(`crm`)일 때.
     * 주인만으로 좁히면 팀원 화면에는 본문이 **보이는데** AI 는 「읽을 것이 없다」고 말한다.
     * 반대로 넓히면 「나만 보기」로 둔 본문이 팀 AI 제안으로 새어 나간다.
     * service_role 로 읽으므로 이 판정을 **코드가 명시로** 한다(RLS 가 안 막아 준다).
     */
    const note = await loadReadableNote(meeting.noteId, hostUserId)
    if (!note) return 0
    const source = pickTranscriptSource(note)
    if (!source) return 0

    const res = await transcribe(
      workspaceId, actorId, meetingId,
      pastedTranscriptAdapter(source, NOTE_SNAPSHOT_VENDOR),
      `meeting_notes/${note.id}`,
    )
    return res.segmentCount
  } catch {
    // 재료를 못 구한 것이 추출을 막을 이유는 아니다 — 추출이 스스로 「읽을 것이 없다」고 답한다
    return 0
  }
}

/** 제목 동기화 결과 — 화면이 무엇을 말할지 정하는 데 쓴다 */
export type TitleSyncResult = 'synced' | 'unchanged' | 'no_note' | 'not_owner'

/**
 * CRM 에서 제목을 고치면 **원본 회의노트 제목도 함께 고친다** — 제목은 한 벌이다.
 *
 * ## 왜 이 함수가 생겼나 (사용자 지적 2026-08-31)
 * 회의노트는 「8/31 미팅」, CRM 미팅은 「8/31 김해사업 미팅」이었다. 같은 회의인데 이름이 둘이다.
 * 원인은 `PATCH /api/crm/meetings/:id` 가 `crm_meeting.title` 만 썼기 때문이다 —
 * 노트는 자기 제목이 바뀐 줄 몰랐다. 그리고 그 어긋남을 「다시 가져오기」가 반대 방향으로
 * 덮으면서 **사용자가 고친 제목이 사라졌다.**
 *
 * ## 권한 경계 — 내 노트일 때만 고친다
 * 회의노트는 개인 소유(RLS `user_id`)이고 CRM 미팅은 워크스페이스 공유다.
 * 남의 노트까지 고치게 두면 팀원이 남의 개인 기록을 바꾸는 일이 된다.
 * 그래서 소유 확인을 **코드가 명시로** 한다(service_role 이라 RLS 가 안 막아 준다).
 * 남의 노트면 `not_owner` 를 돌려주고, 화면은 그 입력을 애초에 못 누르게 그린다.
 *
 * ## 스냅샷 시각을 왜 함께 만지나
 * 노트를 고치면 `updated_at` 이 올라가고, 그러면 CRM 이 「원본이 수정됐어요」를 띄운다 —
 * **내가 CRM 에서 방금 고친 것인데.** 그래서 원래 어긋나 있지 않았을 때만 스냅샷 시각을 따라 올린다.
 * 이미 어긋나 있었다면(본문이 먼저 바뀌어 있었다면) 그 사실을 지우지 않는다.
 */
export async function syncNoteTitle(
  workspaceId: string,
  hostUserId: string,
  meetingId: string,
  title: string,
): Promise<TitleSyncResult> {
  const next = normalizeText(title)
  if (!next) return 'unchanged'

  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { id: meetingId, deletedAt: null },
    select: { id: true, noteId: true, noteSyncedAt: true },
  }) as { id: string; noteId: string | null; noteSyncedAt: Date | null } | null
  if (!meeting?.noteId) return 'no_note'

  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: before } = await admin
    .from('meeting_notes')
    .select('id, user_id, title, updated_at, deleted_at')
    .eq('id', meeting.noteId)
    .maybeSingle()

  const row = before as {
    id: string; user_id: string; title: string | null
    updated_at: string; deleted_at: string | null
  } | null
  if (!row || row.deleted_at) return 'no_note'
  if (row.user_id !== hostUserId) return 'not_owner'
  // 같은 값이면 쓰지 않는다 — 쓰면 updated_at 만 올라가 「원본이 수정됐어요」가 헛되게 뜬다
  if ((normalizeText(row.title) ?? '') === next) return 'unchanged'

  const wasStale = isNoteNewerThanSnapshot(row.updated_at, meeting.noteSyncedAt ?? null)

  const { data: after, error } = await admin
    .from('meeting_notes')
    .update({ title: next })
    .eq('id', meeting.noteId)
    .eq('user_id', hostUserId)
    .select('updated_at')
    .maybeSingle()
  // supabase-js 는 실패를 던지지 않는다 — 반환 오류를 반드시 본다
  if (error || !after?.updated_at) return 'no_note'

  if (!wasStale) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).crmMeeting.updateMany({
      where: { id: meetingId },
      data: { noteSyncedAt: new Date(after.updated_at as string) },
    })
  }
  return 'synced'
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

/* ────────────────────────────────────────────────────────────────────────────
 * 공개 상태 — 손잡이 하나로 모은 자리 (v0.7.596)
 *
 * 사용자 지적(2026-08-24): *"영업 CRM 연결 해제와 연결이 의미가 있나?
 * 어차피 나만보기로 했을때는 변화가 있나?"*
 *
 * 예전엔 셋이 흩어져 있었다 — `visibility`(원본 읽기) · `noteId`(원본 링크) ·
 * CRM 사본(끌 방법 없음). 여기서 하나로 받는다. 판정 규칙은 `lib/meeting/share-state.ts`.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 휴지통에 있는 그 회의의 미팅을 **되살린다.** 없으면 null.
 *
 * ## 왜 필요한가
 *
 * 확인창이 *"지운 미팅은 30일 안에 되살릴 수 있습니다"* 라고 약속한다. 그런데
 * 다시 올릴 때 `findPublished` 는 살아 있는 것만 찾으므로(`deletedAt: null`)
 * **새 미팅을 만들었다.** 목록에 중복이 뜨지는 않지만, 그 미팅에 붙여 둔
 * 회사·딜·AI 제안이 휴지통에 남고 새 미팅은 빈 채로 시작한다 — 약속이 반만 지켜진 것이다.
 *
 * 되살리면 붙여 둔 것이 그대로 돌아온다. 이것이 "되돌릴 수 있다"의 온전한 뜻이다.
 */
async function restorePublished(
  workspaceId: string,
  actorId: string | null,
  noteId: string,
): Promise<{ id: string } | null> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trashed = await (tx as any).crmMeeting.findFirst({
      // 휴지통을 일부러 들여다본다 — 명시하지 않으면 가드가 살아 있는 것만 보여 준다
      where: { noteId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true },
    }) as { id: string } | null
    if (!trashed) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeeting.updateMany({
      /**
       * **삭제된 행임을 여기서도 명시한다.** 워크스페이스 가드는 소프트 삭제 모델의
       * 조회에 `deletedAt: null` 을 자동으로 붙인다 — 명시하지 않으면 되살릴 대상이
       * 조건에서 빠져 **0건이 갱신되고 응답은 200 이다**(아무 일도 안 일어난다).
       */
      where: { id: trashed.id, deletedAt: { not: null } },
      data: { deletedAt: null },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.restored',
      targetType: 'meeting', targetId: trashed.id,
    })
    return { id: trashed.id }
  })
}

/** 지금 이 회의노트가 팀에게 어디까지 보이는지 읽는다 */
export async function readNoteShareState(
  workspaceId: string,
  noteId: string,
  hostUserId: string,
): Promise<{ state: MeetingShareState; meetingId: string | null }> {
  const meeting = await findPublished(workspaceId, noteId)

  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('user_id, visibility, deleted_at')
    .eq('id', noteId)
    .maybeSingle()

  const row = data as { user_id: string; visibility: string | null; deleted_at: string | null } | null
  // 원본이 없거나 남의 것이면 이 사람이 상태를 정할 자격이 없다 — 화면이 스위치를 감춘다
  const owned = !!row && !row.deleted_at && row.user_id === hostUserId

  return {
    state: readShareState({
      hasLiveMeeting: !!meeting,
      hasNoteLink: !!meeting,
      visibility: owned && row.visibility === NOTE_VISIBILITY.CRM
        ? NOTE_VISIBILITY.CRM
        : NOTE_VISIBILITY.PRIVATE,
    }),
    meetingId: meeting?.id ?? null,
  }
}

export interface SetShareStateInput {
  noteId: string
  next: MeetingShareState
  /** 새로 올릴 때만 쓴다 — 이미 올라간 건은 미팅 화면에서 바꾼다 */
  companyId?: string | null
  dealId?: string | null
}

/**
 * 공개 상태를 **바꾼다.**
 *
 * ## 순서가 규칙이다
 *
 * 두 저장소(회의노트 = Supabase, 미팅 = Prisma)를 건드리므로 한 트랜잭션으로 못 묶는다.
 * 그래서 **중간에 끊겨도 더 닫힌 쪽으로 남도록** 순서를 정한다:
 *
 *   · 좁히는 방향(→ PRIVATE): **원본을 먼저 잠그고** 미팅을 지운다.
 *     중간에 끊기면 "원본 잠김 + 미팅 남음" = `RECORD_ONLY` — 열려 있지 않다.
 *   · 넓히는 방향(→ TEAM):    **미팅을 먼저 만들고** 원본을 연다.
 *     중간에 끊기면 "미팅 있음 + 원본 잠김" = `RECORD_ONLY` — 역시 열려 있지 않다.
 *
 * 어느 쪽으로 실패해도 착지점이 `RECORD_ONLY` 다. 조용히 더 열리는 일이 없다.
 *
 * ## `noteId` 를 지우지 않는다
 *
 * 예전 "연결 해제"는 `noteId = null` 을 했고, 그 탓에 재발행이 기존 미팅을 못 찾아
 * **같은 회의를 두 벌** 만들었다. 여기에는 링크를 끊는 코드가 없다.
 */
export async function setNoteShareState(
  workspaceId: string,
  actorId: string | null,
  hostUserId: string,
  input: SetShareStateInput,
): Promise<{ state: MeetingShareState; meetingId: string | null }> {
  const plan = planShareState(input.next)
  const before = await readNoteShareState(workspaceId, input.noteId, hostUserId)

  // 원본 주인만 정할 수 있다 — 남의 회의 공개 범위를 바꾸는 창구가 되면 안 된다
  await loadOwnNote(input.noteId, hostUserId)

  const setVisibility = async () => {
    const { createAdminClient } = await import('../../supabase/server.ts')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin
      .from('meeting_notes')
      .update({ visibility: plan.visibility })
      .eq('id', input.noteId)
      .eq('user_id', hostUserId)
    // supabase-js 는 실패를 던지지 않는다 — 반환 오류를 반드시 본다
    if (error) throw new CrmError('CONFLICT', '공개 범위를 바꾸지 못했습니다.')
  }

  let meetingId = before.meetingId

  if (!plan.wantMeeting) {
    await setVisibility()                                   // ① 먼저 잠근다
    if (meetingId) await deleteMeeting(workspaceId, actorId, meetingId)  // ② 그다음 내린다
    meetingId = null
  } else {
    if (!meetingId) {
      /**
       * **되살리기가 먼저다.** 예전에 올렸다가 내린 회의면 휴지통에 그 미팅이 있고,
       * 거기에 회사·딜·AI 제안이 붙어 있다. 새로 만들면 그게 전부 두고 온 것이 된다.
       */
      const restored = await restorePublished(workspaceId, actorId, input.noteId)
      if (restored) {
        meetingId = restored.id
      } else {
        // 처음 올리는 건이다. 발행은 멱등이라 두 번 눌러도 안전하다
        const published = await publishFromNote(workspaceId, actorId, hostUserId, {
          noteId: input.noteId,
          companyId: input.companyId ?? null,
          dealId: input.dealId ?? null,
        })
        meetingId = published.meetingId
      }
    }
    await setVisibility()                                   // ② 미팅이 선 다음 연다
  }

  if (meetingId) {
    await withCrmTx(workspaceId, async (tx) => {
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId, action: 'meeting.share_state_changed',
        targetType: 'meeting', targetId: meetingId as string,
        beforeJson: { state: before.state },
        afterJson: { state: input.next },
      })
    })
  }

  return { state: input.next, meetingId }
}
