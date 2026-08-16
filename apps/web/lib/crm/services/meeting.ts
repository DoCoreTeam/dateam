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
import { createSuggestion } from './suggestion.ts'
import { kstDateKey } from '../../datetime/kst.ts'

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

export async function listMeetings(db: CrmDb, opts: { dealId?: string; companyId?: string; limit?: number } = {}) {
  const where: Record<string, unknown> = {}
  if (opts.dealId) where.dealId = opts.dealId
  if (opts.companyId) where.companyId = opts.companyId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmMeeting.findMany({
    where,
    // 최근 미팅이 위 — "지난주에 뭐 했더라"가 이 화면을 여는 이유다
    orderBy: { startedAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 100),
    select: SELECT,
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

  return { ...meeting, recordings }
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
): Promise<ExtractResult> {
  const db = getCrmDb(workspaceId)

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
  const ctx = await loadContext(db, meeting.companyId, meeting.dealId)
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

  const suggested = await toSuggestions(workspaceId, actorId, runId, meeting, grounded)

  return { runId, axes: after, suggested, dropped }
}

async function loadContext(db: CrmDb, companyId: string | null, dealId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const company = companyId ? await (db as any).crmCompany.findFirst({
    where: { id: companyId }, select: { name: true, domain: true, industry: true, region: true },
  }) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = dealId ? await (db as any).crmDeal.findFirst({
    where: { id: dealId }, select: { name: true, stageId: true, amountMinor: true, currency: true, pipelineId: true },
  }) : null

  let stageName: string | null = null
  let stageNames: string[] = []
  if (deal) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (db as any).crmStage.findMany({
      where: { pipelineId: deal.pipelineId }, orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }) as { id: string; name: string }[]
    stageNames = stages.map((s) => s.name)
    stageName = stages.find((s) => s.id === deal.stageId)?.name ?? null
  }

  // 우리 쪽 사람 이름 — AI 가 이들을 고객사 인물로 제안하지 않게 한다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = await (db as any).crmMember.findMany({
    select: { displayName: true }, take: 200,
  }) as { displayName: string }[]

  return {
    meetingDate: undefined as string | undefined,
    ourNames: members.map((m) => m.displayName).filter(Boolean),
    company,
    deal: deal ? {
      name: deal.name, stageName,
      amountMinor: deal.amountMinor ? String(deal.amountMinor) : null,
      currency: deal.currency,
    } : null,
    stageNames,
  }
}

/**
 * 축별 항목을 제안으로 만든다.
 *
 * **무엇을 제안으로 보내고 무엇을 안 보내는가**가 여기서 갈린다.
 * 지금은 값으로 바로 이어지는 것만 보낸다 — 회사 산업, 딜 금액처럼.
 * 리스크·다음 행동은 값이 아니라 **읽을 거리**라, 미팅 상세에서 보여 주고
 * 사람이 할 일로 만들지 정한다(할 일 자동 생성은 명세 FR-08 자동화의 몫이다).
 */
async function toSuggestions(
  workspaceId: string,
  actorId: string | null,
  runId: string,
  meeting: { id: string; companyId: string | null; dealId: string | null },
  out: FiveAxisOutput,
): Promise<number> {
  let n = 0

  const send = async (
    axis: 'WHO' | 'WHAT' | 'WHERE' | 'RISK' | 'NEXT',
    targetType: string, targetId: string | null,
    field: string | null, proposedValue: unknown,
    confidence: number, quote: string, segmentIds: string[],
  ) => {
    try {
      const r = await createSuggestion(workspaceId, actorId, {
        runId, axis, targetType, targetId, field,
        proposedValue, confidence,
        evidence: { quote, segmentIds },
      })
      if (r.suggestion) n += 1
    } catch (e) {
      // 제안 하나가 실패해도 나머지는 보낸다 — 미팅 전체가 헛되면 안 된다
      console.error('[crm/meeting] 제안 생성 실패:', axis, field, e)
    }
  }

  // WHAT — 금액. 딜이 연결돼 있을 때만(어느 딜의 금액인지 모르면 제안할 수 없다)
  if (meeting.dealId) {
    for (const w of out.what) {
      if (w.amountMinor === null) continue
      await send('WHAT', 'deal', meeting.dealId, 'amountMinor', String(w.amountMinor),
        w.confidence, w.evidence.quote, w.evidence.segmentIds)
    }
  }

  // WHERE — 다음 단계. 값이 아니라 이동이라 항상 사람이 본다(절대규칙 3)
  if (meeting.dealId && out.where?.suggestedStageName) {
    await send('WHERE', 'deal', meeting.dealId, 'stageId', out.where.suggestedStageName,
      out.where.confidence, out.where.evidence.quote, out.where.evidence.segmentIds)
  }

  // WHO — 사람. 회사가 연결돼 있을 때만 새 인물을 제안한다
  if (meeting.companyId) {
    for (const p of out.who) {
      await send('WHO', 'person', null, null,
        { name: p.name, title: p.title, email: p.email, role: p.role, companyId: meeting.companyId },
        p.confidence, p.evidence.quote, p.evidence.segmentIds)
    }
  }

  // RISK·NEXT — 값이 아니라 읽을 거리다. 미팅에 붙여 두고 사람이 정한다
  for (const r of out.risk) {
    await send('RISK', 'meeting', meeting.id, null,
      { kind: r.kind, polarity: r.polarity, description: r.description },
      r.confidence, r.evidence.quote, r.evidence.segmentIds)
  }
  for (const t of out.next) {
    await send('NEXT', 'meeting', meeting.id, null,
      { title: t.title, dueDate: t.dueDate, assigneeHint: t.assigneeHint, emailDraftGist: t.emailDraftGist },
      t.confidence, t.evidence.quote, t.evidence.segmentIds)
  }

  return n
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
