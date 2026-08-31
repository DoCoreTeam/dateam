/**
 * 미팅 (dacrm 구현명세 §3.2 F2)
 *
 * 미팅이 CRM 에서 하는 일은 **"그날 무슨 이야기가 오갔는지"를 딜에 붙이는 것**이다.
 * 그게 없으면 딜은 금액과 단계만 남은 껍데기가 되고,
 * 담당자가 바뀌면 "이 딜이 왜 여기까지 왔는지" 아무도 모른다.
 *
 * 흐름은 셋이다.
 *   ① 미팅을 만든다 (회사·딜에 붙인다)
 *   ② 전사를 넣는다 (녹음 전사 또는 붙여넣기)
 *   ③ 5축을 뽑아 **제안으로** 보낸다 — 코어에 직접 쓰지 않는다(절대규칙 1)
 *
 * ③이 이 파일의 핵심이다. AI 가 미팅에서 읽어낸 것은 전부 인박스를 거친다.
 * 사람이 보고 수락해야 회사·딜·할 일이 된다.
 */

import type { CrmDb } from '../db/client.ts'
import { getCrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { requireText, normalizeText } from '../domain/normalize.ts'
import { canTransitRecording } from '../domain/state-machines.ts'
import type { SttAdapter } from '../stt/adapter.ts'
import { runAi } from '../ai/runner.ts'
import type { AiAdapter } from '../ai/runner.ts'
import { buildMeetingExtractPrompt, MEETING_EXTRACT_VERSION } from '../ai/prompts/meeting-extract.v1.ts'
import type { Segment } from '../ai/prompts/meeting-extract.v1.ts'
import { parseFiveAxis, dropUngrounded, countAxes } from '../ai/schemas/five-axis.ts'
import type { FiveAxisOutput } from '../ai/schemas/five-axis.ts'
import { fiveAxisToSuggestions } from './five-axis-suggest.ts'
import { loadExtractContext } from './extract-context.ts'
import { kstDateKey } from '../../datetime/kst.ts'
import {
  clampLimit, decodeCursor, cursorWhereOn, orderDescOn, toPageOn, countIfFirstPage,
} from '../db/cursor.ts'
import type { CursorInput, CursorPage } from '../db/cursor.ts'
import { meetingStatusKey, MEETING_STATUS_ORDER } from '../ui/meeting-status.ts'
import type { MeetingStatusKey } from '../ui/meeting-status.ts'

export interface MeetingInput {
  title: string
  startedAt: string
  endedAt?: string | null
  companyId?: string | null
  dealId?: string | null
  location?: string | null
}

const SELECT = {
  id: true, title: true, startedAt: true, endedAt: true,
  companyId: true, dealId: true, location: true, summaryMd: true,
  attendeesJson: true, createdAt: true, updatedAt: true,
  // 원본 회의노트 연결 — 화면이 "원본이 그 뒤 수정됨"을 판단하려면 둘 다 필요하다
  noteId: true, noteSyncedAt: true,
} as const

export async function createMeeting(
  workspaceId: string,
  actorId: string | null,
  input: MeetingInput,
): Promise<{ id: string }> {
  const title = requireText(input.title)
  if (!title) throw new CrmError('VALIDATION_FAILED', '미팅 제목을 입력해 주세요.', { field: 'title' })

  const startedAt = new Date(input.startedAt)
  if (Number.isNaN(startedAt.getTime())) {
    throw new CrmError('VALIDATION_FAILED', '미팅 시각을 다시 확인해 주세요.', { field: 'startedAt' })
  }

  return withCrmTx(workspaceId, async (tx) => {
    /**
     * 회사·딜이 실재하는지 본다.
     *
     * 이 관계에는 FK 가 없다(스키마가 문자열 컬럼으로만 두었다).
     * DB 가 안 막아 주므로 코드가 막는다 — 안 그러면 지워진 딜을 가리키는 유령 미팅이 생긴다.
     */
    if (input.companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const co = await (tx as any).crmCompany.findFirst({ where: { id: input.companyId }, select: { id: true } })
      if (!co) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.', { field: 'companyId' })
    }
    if (input.dealId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await (tx as any).crmDeal.findFirst({ where: { id: input.dealId }, select: { id: true, companyId: true } })
      if (!d) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.', { field: 'dealId' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmMeeting.create({
      data: {
        title, startedAt,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        location: normalizeText(input.location),
        createdById: actorId,
        source: 'HUMAN',
      },
      select: { id: true },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.created',
      targetType: 'meeting', targetId: created.id, afterJson: { title },
    })
    return created
  })
}

export interface MeetingPatch {
  title?: string
  startedAt?: string
  endedAt?: string | null
  companyId?: string | null
  dealId?: string | null
  location?: string | null
}

/**
 * 미팅 고치기 (부분 수정 — 안 보낸 필드는 건드리지 않는다).
 *
 * **왜 뒤늦게 생겼나**: 이 라우트에는 GET·DELETE 만 있었다.
 * 제목에 오타가 나거나 딜을 잘못 고르면 **지우고 다시 만드는 것 말고 방법이 없었고**,
 * 지우면 그 미팅에서 나온 미처리 제안까지 함께 사라졌다(실측 v0.7.573 조사).
 *
 * 회사·딜 실재 확인은 `createMeeting` 과 같은 이유로 한다 — 이 관계에는 FK 가 없다.
 * `null` 을 명시로 보내면 **연결을 끊는다**(빼는 것도 수정이다).
 */
export async function updateMeeting(
  workspaceId: string,
  actorId: string | null,
  id: string,
  patch: MeetingPatch,
): Promise<{ id: string }> {
  const data: Record<string, unknown> = {}

  if (patch.title !== undefined) {
    const title = requireText(patch.title)
    if (!title) throw new CrmError('VALIDATION_FAILED', '미팅 제목을 입력해 주세요.', { field: 'title' })
    data.title = title
  }
  if (patch.startedAt !== undefined) {
    const started = new Date(patch.startedAt)
    if (Number.isNaN(started.getTime())) {
      throw new CrmError('VALIDATION_FAILED', '미팅 시각을 다시 확인해 주세요.', { field: 'startedAt' })
    }
    data.startedAt = started
  }
  if (patch.endedAt !== undefined) {
    if (patch.endedAt === null) data.endedAt = null
    else {
      const ended = new Date(patch.endedAt)
      if (Number.isNaN(ended.getTime())) {
        throw new CrmError('VALIDATION_FAILED', '끝난 시각을 다시 확인해 주세요.', { field: 'endedAt' })
      }
      data.endedAt = ended
    }
  }
  if (patch.location !== undefined) data.location = normalizeText(patch.location)
  if (patch.companyId !== undefined) data.companyId = patch.companyId || null
  if (patch.dealId !== undefined) data.dealId = patch.dealId || null

  if (Object.keys(data).length === 0) {
    throw new CrmError('VALIDATION_FAILED', '바꿀 내용이 없습니다.')
  }

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmMeeting.findFirst({
      where: { id },
      select: { id: true, title: true, startedAt: true, companyId: true, dealId: true, location: true },
    })
    if (!before) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

    // 지워진 회사·딜을 가리키는 유령 미팅을 만들지 않는다 (FK 가 없어 DB 가 안 막아 준다)
    if (data.companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const co = await (tx as any).crmCompany.findFirst({ where: { id: data.companyId }, select: { id: true } })
      if (!co) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.', { field: 'companyId' })
    }
    if (data.dealId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await (tx as any).crmDeal.findFirst({ where: { id: data.dealId }, select: { id: true } })
      if (!d) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.', { field: 'dealId' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmMeeting.updateMany({ where: { id }, data })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.updated',
      targetType: 'meeting', targetId: id,
      beforeJson: before, afterJson: data,
    })
    return { id }
  })
}

export async function listMeetings(
  db: CrmDb,
  opts: { dealId?: string; companyId?: string; noteId?: string; limit?: number } = {},
) {
  const where: Record<string, unknown> = {}
  if (opts.dealId) where.dealId = opts.dealId
  if (opts.companyId) where.companyId = opts.companyId
  // 회의노트 화면이 "이 노트가 이미 영업 CRM 에 올라갔나"를 묻는 통로다.
  // 이게 없으면 노트 쪽은 발행 여부를 알 방법이 없어 버튼이 늘 "올리기"로 남는다.
  if (opts.noteId) where.noteId = opts.noteId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmMeeting.findMany({
    where,
    // 최근 미팅이 위 — "지난주에 뭐 했더라"가 이 화면을 여는 이유다
    orderBy: { startedAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 100),
    select: SELECT,
  })
}

/* ── 훑는 목록 ──────────────────────────────────────────────── */

export interface MeetingListRow {
  id: string
  title: string
  startedAt: Date
  companyId: string | null
  dealId: string | null
  location: string | null
  summaryMd: string | null
  noteId: string | null
  /** 붙어 있는 회사·딜의 이름. id 만 보이면 "어느 건이었지"를 매번 눌러 봐야 한다 */
  companyName: string | null
  dealName: string | null
  /** 읽는 시점 판정 상태 — meeting-status.ts 가 말과 색을 정한다 */
  statusKey: MeetingStatusKey
}

export interface ListMeetingPageInput extends CursorInput {
  /** 제목·장소 부분 일치 */
  q?: string | null
  /** 상태 하나로 좁히기. 저장된 컬럼이 아니라 읽는 시점 판정이라 여기서 조건으로 번역한다 */
  status?: string | null
  dealId?: string | null
  companyId?: string | null
}

/**
 * 미팅 목록(커서·검색·상태) — 훑는 화면용.
 *
 * **정렬 축이 startedAt 인 이유**: 이 화면이 답하는 질문은 "지난주에 누구를 만났나"다.
 * updatedAt 으로 세우면 지난달 미팅의 오타 수정 하나가 어제 미팅보다 위로 올라온다.
 *
 * **회사·딜 이름을 왜 서버가 붙이나**: 예전엔 화면이 미팅 20건을 받은 뒤
 * 회사·딜마다 상세 API 를 따로 불렀다 — 한 화면에 최대 40번의 왕복(N+1)이었고,
 * 그중 하나만 실패해도 그 줄만 이름이 빈 채로 남았다. 여기서 한 번에 묶어 준다.
 * (CrmMeeting 은 회사·딜에 Prisma 관계가 없어 조인 대신 id 묶음 조회를 쓴다.)
 */
export async function listMeetingsPage(
  db: CrmDb,
  input: ListMeetingPageInput = {},
): Promise<CursorPage<MeetingListRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const q = normalizeText(input.q)
  const status = normalizeText(input.status)

  // 모르는 상태는 여기서 막는다 — 그대로 넘기면 조건이 조용히 무시돼
  // "필터를 걸었는데 전부 나오는" 화면이 된다.
  if (status && !MEETING_STATUS_ORDER.includes(status as MeetingStatusKey)) {
    throw new CrmError(
      'VALIDATION_FAILED',
      `모르는 미팅 상태입니다: ${status}. ${MEETING_STATUS_ORDER.join(' · ')} 중에서 골라 주세요.`,
      { field: 'status' },
    )
  }

  const where: Record<string, unknown> = {}
  if (input.dealId) where.dealId = input.dealId
  if (input.companyId) where.companyId = input.companyId

  // 검색은 AND 로 따로 묶는다 — where.OR 에 그냥 넣으면 다른 OR 조건을 덮어쓴다
  const search = q
    ? { OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { location: { contains: q, mode: 'insensitive' } },
    ] }
    : null

  /**
   * 상태 조건을 DB 조건으로 번역한다.
   *
   * '정리됨'만 컬럼으로 판정할 수 있다(summaryMd). 나머지는 녹음의 상태 조합이라
   * 관계 조건(some/none/every)으로 옮긴다 — 화면에서 거르면 페이지마다 개수가 달라진다.
   */
  const statusWhere = statusCondition(status as MeetingStatusKey | null)

  const cur = cursorWhereOn('startedAt', decoded)
  const parts = [where, search, statusWhere, cur].filter(Boolean) as Record<string, unknown>[]
  const finalWhere = parts.length > 1 ? { AND: parts } : (parts[0] ?? {})
  const countWhere = [where, search, statusWhere].filter(Boolean) as Record<string, unknown>[]

  const [rows, total] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmMeeting.findMany({
      where: finalWhere,
      select: { ...SELECT, recordings: { select: { status: true } } },
      orderBy: orderDescOn('startedAt'),
      take: limit + 1,
    }),
    countIfFirstPage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).crmMeeting,
      countWhere.length > 1 ? { AND: countWhere } : (countWhere[0] ?? {}),
      decoded,
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ]) as [any[], number | undefined]

  const named = await attachNames(db, rows)
  return toPageOn('startedAt', named, limit, total)
}

/** 읽는 시점 상태를 DB 조건으로 — 화면에서 거르면 페이지마다 개수가 달라진다 */
function statusCondition(status: MeetingStatusKey | null): Record<string, unknown> | null {
  if (!status) return null
  const summarized = { NOT: [{ summaryMd: null }, { summaryMd: '' }] }
  if (status === 'SUMMARIZED') return summarized
  // 정리된 건은 다른 상태로 세지 않는다 — 겹치면 같은 미팅이 두 필터에 다 나온다
  const notSummarized = { OR: [{ summaryMd: null }, { summaryMd: '' }] }
  if (status === 'EMPTY') return { AND: [notSummarized, { recordings: { none: {} } }] }
  if (status === 'TRANSCRIBED') {
    return { AND: [notSummarized, { recordings: { some: { status: { in: ['TRANSCRIBED', 'SUMMARIZED'] } } } }] }
  }
  if (status === 'TRANSCRIBING') {
    return { AND: [
      notSummarized,
      { recordings: { none: { status: { in: ['TRANSCRIBED', 'SUMMARIZED'] } } } },
      { recordings: { some: { status: { in: ['UPLOADED', 'TRANSCRIBING'] } } } },
    ] }
  }
  // 전부 실패 — 하나라도 살아 있으면 실패라고 부르지 않는다
  return { AND: [
    notSummarized,
    { recordings: { some: { status: 'FAILED' } } },
    { recordings: { none: { status: { not: 'FAILED' } } } },
  ] }
}

/** 회사·딜 이름을 한 번에 붙인다(목록 왕복 N+1 제거) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function attachNames(db: CrmDb, rows: any[]): Promise<MeetingListRow[]> {
  const companyIds = Array.from(new Set(rows.map((r) => r.companyId).filter(Boolean))) as string[]
  const dealIds = Array.from(new Set(rows.map((r) => r.dealId).filter(Boolean))) as string[]

  const [companies, deals] = await Promise.all([
    companyIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    dealIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmDeal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]) as [{ id: string; name: string }[], { id: string; name: string }[]]

  const nameOf = new Map<string, string>()
  for (const c of companies) nameOf.set(`c:${c.id}`, c.name)
  for (const d of deals) nameOf.set(`d:${d.id}`, d.name)

  return rows.map((r) => {
    const { recordings, ...rest } = r
    const statuses = ((recordings ?? []) as { status: string }[]).map((x) => x.status)
    return {
      ...rest,
      companyName: r.companyId ? nameOf.get(`c:${r.companyId}`) ?? null : null,
      dealName: r.dealId ? nameOf.get(`d:${r.dealId}`) ?? null : null,
      statusKey: meetingStatusKey({ summaryMd: r.summaryMd ?? null, recordingStatuses: statuses }),
    } as MeetingListRow
  })
}

/**
 * 이 미팅에서 나온 제안 전부.
 *
 * `targetId = 미팅id` 로만 찾으면 **딜·인물로 간 제안이 사라진다** —
 * 금액은 딜에, 참석자는 인물에 붙기 때문이다.
 * 그러면 화면은 "AI가 2건 찾음"이라 말하는데 알림은 "6건 보냄"이라 말한다.
 * 그래서 **이 미팅의 AI 실행(run)** 을 기준으로 찾는다.
 */
export async function listMeetingSuggestions(db: CrmDb, meetingId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runs = await (db as any).crmAiRun.findMany({
    where: { kind: 'MEETING_EXTRACT', inputRef: { path: ['meetingId'], equals: meetingId } },
    select: { id: true },
  }) as { id: string }[]
  if (runs.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmAiSuggestion.findMany({
    where: { runId: { in: runs.map((r) => r.id) } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, axis: true, targetType: true, targetId: true, field: true,
      proposedValueJson: true, confidence: true, evidenceJson: true,
      status: true, createdAt: true,
    },
  })
}

export async function getMeeting(db: CrmDb, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({ where: { id }, select: SELECT })
  if (!meeting) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordings = await (db as any).crmMeetingRecording.findMany({
    where: { meetingId: id },
    select: { id: true, status: true, sttVendor: true, error: true, durationSec: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  /**
   * 회사·딜 **이름**을 함께 준다(추가 전용).
   *
   * 상세가 이 값을 읽기만 할 때는 id 만으로 "회사 열기" 링크를 그리면 됐다.
   * 그런데 이제 상세에서 회사·딜을 **고칠 수 있어야 하고**(사용자 지시 2026-08-24),
   * 고르는 상자는 지금 무엇이 골라져 있는지를 이름으로 보여 줘야 한다.
   * 화면이 건당 다시 물으면 목록에서 없앤 N+1 이 상세에서 되살아난다 —
   * 목록과 같은 방식으로 서버가 한 번에 붙인다.
   */
  const [named] = await attachNames(db, [meeting])

  // meeting 을 먼저 펼친다 — attachNames 의 반환 타입(MeetingListRow)이 목록용이라
  // noteSyncedAt 같은 상세 전용 필드를 타입에서 떨어뜨린다. 값은 같지만 타입이 좁아진다.
  return { ...meeting, ...named, recordings }
}

/** 전사 구간 — 미팅 상세가 근거를 보여 주려면 필요하다 */
export async function listSegments(db: CrmDb, recordingId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmTranscriptSegment.findMany({
    where: { recordingId }, orderBy: { idx: 'asc' },
    select: { id: true, idx: true, speaker: true, startMs: true, endMs: true, text: true },
  })
}

/**
 * 전사를 넣는다.
 *
 * 상태 전이는 `state-machines.ts` 가 판정한다 — 여기서 직접 상태를 정하지 않는다.
 * 실패하면 retryCount 를 올리고 3회를 넘으면 FAILED 로 둔다(명세 §3.2-3).
 * **조용히 멈추지 않는다.** 실패한 이유를 error 에 남겨야 화면이 사람에게 말할 수 있다.
 */
export async function transcribe(
  workspaceId: string,
  actorId: string | null,
  meetingId: string,
  adapter: SttAdapter,
  fileUrl = '(붙여넣기)',
): Promise<{ recordingId: string; segmentCount: number }> {
  const db = getCrmDb(workspaceId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({ where: { id: meetingId }, select: { id: true } })
  if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

  const recording = await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (tx as any).crmMeetingRecording.create({
      data: { meetingId, fileUrl, status: 'UPLOADED', sttVendor: adapter.vendor },
      select: { id: true, status: true, retryCount: true },
    })
  })

  const move = canTransitRecording('UPLOADED', 'TRANSCRIBING', { retryCount: 0 })
  if (!move.ok) throw new CrmError('INVALID_TRANSITION', '지금 상태에서는 전사할 수 없습니다.')

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeetingRecording.updateMany({
      where: { id: recording.id }, data: { status: 'TRANSCRIBING' },
    })
  })

  let result
  try {
    result = await adapter.transcribe(fileUrl)
  } catch (e) {
    // 실패를 삼키면 화면은 "전사 중"에 멈춰 있고 아무도 이유를 모른다
    await withCrmTx(workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmMeetingRecording.updateMany({
        where: { id: recording.id },
        data: { status: 'FAILED', error: e instanceof Error ? e.message : String(e), retryCount: 1 },
      })
    })
    throw new CrmError('CONFLICT', '전사에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (result.segments.length === 0) {
    await withCrmTx(workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmMeetingRecording.updateMany({
        where: { id: recording.id }, data: { status: 'FAILED', error: '전사 내용이 비어 있습니다' },
      })
    })
    throw new CrmError('VALIDATION_FAILED', '전사할 내용이 없습니다.')
  }

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmTranscriptSegment.createMany({
      data: result.segments.map((s) => ({ ...s, recordingId: recording.id })),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMeetingRecording.updateMany({
      where: { id: recording.id },
      data: { status: 'TRANSCRIBED', durationSec: result.durationSec, error: null },
    })
    await writeAudit(tx, {
      actorType: 'SYSTEM', actorId, action: 'meeting.transcribed',
      targetType: 'meeting', targetId: meetingId,
      afterJson: { recordingId: recording.id, segments: result.segments.length, vendor: adapter.vendor },
    })
  })

  return { recordingId: recording.id, segmentCount: result.segments.length }
}

export interface ExtractResult {
  runId: string
  axes: Record<string, number>
  /** 인박스로 보낸 제안 수 */
  suggested: number
  /** 근거를 못 대 버린 항목 수 — 이걸 안 세면 "왜 적게 나왔지"를 설명 못 한다 */
  dropped: number
}

/**
 * 전사에서 5축을 뽑아 **제안으로** 보낸다 (명세 §3.2-5·6).
 *
 * 여기가 절대규칙 1이 걸리는 자리다 — AI 가 읽어낸 것은 코어 테이블에 직접 쓰지 않는다.
 * 전부 `CrmAiSuggestion` 을 거쳐 인박스로 가고, 사람이 수락해야 값이 된다.
 * (자동 반영 설정을 켠 필드만 판정에 따라 즉시 반영된다 — 그것도 관문을 거친 결과다)
 */
export async function extractFiveAxis(
  workspaceId: string,
  actorId: string | null,
  meetingId: string,
  adapter: AiAdapter,
  /**
   * 부른 사람의 호스트 사용자 id. 주면 **읽을 것이 없을 때 원본 본문을 재료로 끌어온다.**
   *
   * 왜 여기인가(실측 v0.7.666): 처음에는 `/extract` 라우트에 꽂았는데, 사용자가 실제로
   * 누르는 버튼은 「미팅 끝내기」(`/finish`)였고 그 경로는 이 함수를 **직접** 부른다.
   * 라우트에 꽂으면 주 경로를 지나가지 않는다 — 이 저장소가 반복한 「만들고 안 꽂음」이다.
   * 그래서 두 경로가 다 지나가는 이 자리에 둔다.
   */
  hostUserId?: string,
): Promise<ExtractResult> {
  const db = getCrmDb(workspaceId)

  /**
   * 읽을 것이 없으면 원본 회의노트 본문을 전사 재료로 끌어온다.
   *
   * 순환 import 를 피해 동적으로 부른다 — `meeting-publish` 가 이 모듈의 `transcribe` 를 쓴다.
   * 이미 전사가 있거나, 본문이 비었거나, 볼 수 없는 노트면 아무 일도 하지 않는다(0).
   */
  if (hostUserId) {
    const { snapshotNoteBodyForExtract } = await import('./meeting-publish.ts')
    await snapshotNoteBodyForExtract(workspaceId, actorId, hostUserId, meetingId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { id: meetingId }, select: { id: true, companyId: true, dealId: true, startedAt: true },
  })
  if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recording = await (db as any).crmMeetingRecording.findFirst({
    where: { meetingId, status: 'TRANSCRIBED' },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (!recording) throw new CrmError('VALIDATION_FAILED', '먼저 전사를 넣어 주세요.')

  const rows = await listSegments(db, recording.id)
  if (rows.length === 0) throw new CrmError('VALIDATION_FAILED', '전사 내용이 없습니다.')

  const segments: Segment[] = rows.map((r: { id: string; speaker: string; text: string }) => ({
    id: r.id, speaker: r.speaker, text: r.text,
  }))
  const validIds = new Set(segments.map((s) => s.id))

  // 이미 아는 값을 넘겨 준다 — 같은 값을 다시 제안하면 인박스가 쓰레기로 찬다
  const ctx = await loadExtractContext(db, meeting.companyId, meeting.dealId)
  // 회의 날짜를 알려 준다 — 없으면 "8월 25일까지"를 엉뚱한 연도로 적는다(실측: 2024)
  ctx.meetingDate = kstDateKey(meeting.startedAt)

  const { output, runId } = await runAi<FiveAxisOutput>({
    db, workspaceId, kind: 'MEETING_EXTRACT',
    prompt: {
      version: MEETING_EXTRACT_VERSION,
      build: () => buildMeetingExtractPrompt(segments, ctx),
    },
    input: segments.map((s) => s.text).join('\n'),
    inputRef: { meetingId, recordingId: recording.id, segments: segments.length },
    parse: parseFiveAxis,
    adapter,
    // 전사가 길면 비용도 커진다 — 구간 수로 대략 잡는다(예산이 이걸로 선점된다)
    estimateMinorUsd: BigInt(Math.max(1, Math.ceil(segments.length / 20))),
  })

  const before = countAxes(output)
  const grounded = dropUngrounded(output, validIds)
  const after = countAxes(grounded)
  const dropped = Object.keys(before).reduce((n, k) => n + (before[k] - after[k]), 0)

  // 매핑은 SSOT 를 부른다 — 활동 노트도 같은 5축을 읽으므로 두 벌이 되면 안 된다
  const suggested = await fiveAxisToSuggestions(workspaceId, actorId, runId, {
    companyId: meeting.companyId, dealId: meeting.dealId,
    anchorType: 'meeting', anchorId: meeting.id,
  }, grounded)

  return { runId, axes: after, suggested, dropped }
}

export async function deleteMeeting(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmMeeting.updateMany({
      where: { id }, data: { deletedAt: new Date() },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

    /**
     * 이 미팅에서 나온 **아직 처리 안 된 제안**도 함께 거둔다.
     *
     * 안 거두면 인박스에 고아 제안이 남는다. 근거를 눌러도 없는 미팅으로 가고,
     * 사람이 무심코 반영하면 **사라진 회의의 값**이 CRM 에 들어간다.
     * (실측: 미팅 4건을 지웠는데 제안 9건이 그대로 PENDING 이었다)
     *
     * 이미 사람이 판단한 것(ACCEPTED·REJECTED)은 건드리지 않는다 — 그건 사실로 일어난 일이다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runs = await (tx as any).crmAiRun.findMany({
      where: { kind: 'MEETING_EXTRACT', inputRef: { path: ['meetingId'], equals: id } },
      select: { id: true },
    }) as { id: string }[]
    let orphans = 0
    if (runs.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (tx as any).crmAiSuggestion.updateMany({
        where: { runId: { in: runs.map((x) => x.id) }, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      })
      orphans = r.count
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'meeting.deleted',
      targetType: 'meeting', targetId: id,
      afterJson: { expiredSuggestions: orphans },
    })
  })
}
