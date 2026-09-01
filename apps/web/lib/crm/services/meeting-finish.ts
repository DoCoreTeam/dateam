/**
 * 「미팅 끝내기」 — **한 번 누르면 정리가 끝난다.**
 *
 * 사용자 시나리오(2026-08-27): *"미팅이 끝나고 다음 미팅으로 이동하면서 AI가 CRM에 있는
 * 모든 데이터와 고객사 정보를 고려해서 구조화된 데이터를 채우고"*.
 *
 * 예전에는 같은 일을 하려면 **화면 셋을 오가며 세 번 눌러야** 했다 —
 * 녹음 정지 → 작업대의 「정리」 → 미팅 상세의 「AI로 정리하기」.
 * 차에 타면서 그걸 다 하는 사람은 없다. 그래서 하나로 묶는다.
 *
 * **절대 도중에 멈추지 않는다.** 정리가 실패해도 5축은 시도하고, 5축이 실패해도
 * 끝난 시각은 남는다. 각 단계의 결과를 그대로 돌려주고 **화면이 무엇이 됐고 무엇이 안 됐는지
 * 말한다** — 한 단계가 넘어졌다고 회의 기록 전체를 잃게 두지 않는다.
 *
 * **되돌릴 수 없는 일을 하지 않는다.** 끝난 시각은 지울 수 있고(`updateMeeting`),
 * 5축 결과는 전부 제안으로 가며(절대규칙 1), 정리본은 판이 쌓일 뿐 덮어쓰지 않는다.
 */

import { CrmError } from '../domain/errors.ts'
import { getCrmDb } from '../db/client.ts'
import { updateMeeting, extractFiveAxis } from './meeting.ts'
import { listOpenQuestions, type OpenQuestion } from './ask-suggest.ts'
import type { AiAdapter } from '../ai/runner.ts'

export type FinishStepKey = 'end' | 'digest' | 'note' | 'extract'
export type FinishStepStatus = 'done' | 'skipped' | 'failed'

export interface FinishStep {
  key: FinishStepKey
  status: FinishStepStatus
  /** 사람이 읽는 한 줄 — 화면이 문장을 새로 짓지 않는다 */
  detail: string
}

export interface FinishResult {
  steps: FinishStep[]
  /** 이미 끝나 있었으면 그때 값 그대로 */
  endedAt: string | null
  axes: Record<string, number>
  suggested: number
  dropped: number
  questions: OpenQuestion[]
}

/** 정리(digest)는 호스트 쪽 모듈이라 주입받는다 — 그래야 이 서비스를 그대로 검증할 수 있다 */
export type DigestRunner = (noteId: string) => Promise<{ agendaCount: number }>

export interface FinishDeps {
  adapter: AiAdapter
  /** 없으면 정리 단계를 건너뛴다(원본 회의노트가 없는 옛 미팅) */
  digest?: DigestRunner
  /**
   * 부른 사람의 호스트 사용자 id.
   *
   * 5축 추출에 그대로 넘긴다 — 전사가 없을 때 원본 회의노트 본문을 재료로 끌어오려면
   * «이 사람이 그 노트를 볼 수 있나»를 판정해야 한다(§extractFiveAxis 주석).
   * 없으면 그 폴백만 안 돈다. 나머지 단계는 그대로다.
   */
  hostUserId?: string
}

function why(e: unknown, fallback: string): string {
  if (e instanceof CrmError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/**
 * 원본 회의노트를 「확정」으로 — **이미 확정이면 아무것도 하지 않는다.**
 *
 * 돌려주는 값은 «바꿨나»다. 화면이 「올렸어요」와 「이미 확정이에요」를 구분해 말할 수 있어야
 * 사용자가 무슨 일이 있었는지 안다(둘 다 성공이지만 뜻이 다르다).
 *
 * 회의노트는 호스트(Supabase) 표라 서비스롤로 쓴다 — CRM 은 Prisma 라 같은 트랜잭션이 아니다.
 * 그래서 실패해도 끝내기 전체를 되돌리지 않는다(호출부가 단계로 보고한다).
 */
async function confirmNote(noteId: string): Promise<boolean> {
  const { createAdminClient } = await import('../../supabase/server.ts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data, error: readErr } = await admin
    .from('meeting_notes')
    .select('id, status')
    .eq('id', noteId)
    .maybeSingle()
  // supabase-js 는 오류를 **던지지 않고 반환한다** — 검사하지 않으면 조용히 넘어간다
  if (readErr) throw new CrmError('CONFLICT', '회의노트를 읽지 못했습니다.')
  const row = data as { id: string; status: string } | null
  if (!row) throw new CrmError('NOT_FOUND', '회의노트를 찾을 수 없습니다.')
  if (row.status === 'final') return false

  const { error } = await admin
    .from('meeting_notes')
    .update({ status: 'final' })
    .eq('id', noteId)
  if (error) throw new CrmError('CONFLICT', '회의노트 상태를 바꾸지 못했습니다.')
  return true
}

export async function finishMeeting(
  workspaceId: string,
  actorId: string | null,
  meetingId: string,
  deps: FinishDeps,
  now: Date = new Date(),
): Promise<FinishResult> {
  const db = getCrmDb(workspaceId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting = await (db as any).crmMeeting.findFirst({
    where: { id: meetingId },
    select: { id: true, endedAt: true, noteId: true, companyId: true, dealId: true },
  }) as {
    id: string; endedAt: Date | null; noteId: string | null
    companyId: string | null; dealId: string | null
  } | null
  if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

  const steps: FinishStep[] = []

  // ── ① 끝난 시각. 이미 있으면 덮지 않는다 — 두 번 눌렀다고 시각이 밀리면 기록이 거짓이 된다
  let endedAt: string | null = meeting.endedAt ? meeting.endedAt.toISOString() : null
  if (endedAt) {
    steps.push({ key: 'end', status: 'skipped', detail: '이미 끝난 미팅이에요.' })
  } else {
    try {
      await updateMeeting(workspaceId, actorId, meetingId, { endedAt: now.toISOString() })
      endedAt = now.toISOString()
      steps.push({ key: 'end', status: 'done', detail: '끝난 시각을 남겼어요.' })
    } catch (e) {
      steps.push({ key: 'end', status: 'failed', detail: why(e, '끝난 시각을 남기지 못했어요.') })
    }
  }

  // ── ② 메모 + 녹음을 함께 읽어 정리한다
  if (!meeting.noteId || !deps.digest) {
    steps.push({ key: 'digest', status: 'skipped', detail: '원본 회의 기록이 없어 정리는 건너뛰었어요.' })
  } else {
    try {
      const out = await deps.digest(meeting.noteId)
      steps.push({
        key: 'digest',
        status: 'done',
        detail: out.agendaCount === 0
          ? '정리했지만 확실한 내용을 못 찾았어요.'
          : `안건 ${out.agendaCount}건으로 정리했어요.`,
      })
    } catch (e) {
      // 정리가 안 돼도 5축은 전사만 있으면 돈다 — 여기서 멈추지 않는다
      steps.push({ key: 'digest', status: 'failed', detail: why(e, '정리하지 못했어요.') })
    }
  }

  /*
    ── ③ **원본 회의노트도 「확정」으로 올린다.**

    사용자 지적(2026-09-01): *「CRM에서 회의 끝내기까지 눌렀는데 작성 중? 설계가 잘못된 거 아냐?」*

    회의노트(`meeting_notes`)와 미팅(`crm_meeting`)은 다른 표지만
    **사용자에게는 같은 회의 한 건**이다. 그런데 끝내기가 미팅의 `endedAt` 만 남기고
    노트의 `status` 는 `draft` 로 두어서, 같은 회의를 두 화면이 **다르게 말했다** —
    한쪽은 끝났다고 하고 한쪽은 아직 쓰는 중이라고 한다.

    노트는 개인 소유 «원본»이라 남의 노트를 함부로 확정하지 않는다:
      · 이미 `final` 이면 손대지 않는다(두 번 눌러도 사실이 안 바뀐다)
      · 실패해도 끝내기를 멈추지 않는다(이 서비스의 원칙)
  */
  if (!meeting.noteId) {
    steps.push({ key: 'note', status: 'skipped', detail: '원본 회의노트가 없어요.' })
  } else {
    try {
      const changed = await confirmNote(meeting.noteId)
      steps.push(changed
        ? { key: 'note', status: 'done', detail: '회의노트를 「확정」으로 올렸어요.' }
        : { key: 'note', status: 'skipped', detail: '회의노트는 이미 확정이에요.' })
    } catch (e) {
      steps.push({ key: 'note', status: 'failed', detail: why(e, '회의노트 상태를 바꾸지 못했어요.') })
    }
  }

  // ── ④ 5축을 뽑아 인박스로
  let axes: Record<string, number> = {}
  let suggested = 0
  let dropped = 0
  try {
    const out = await extractFiveAxis(workspaceId, actorId, meetingId, deps.adapter, deps.hostUserId)
    axes = out.axes
    suggested = out.suggested
    dropped = out.dropped
    const total = Object.values(out.axes).reduce((n, v) => n + v, 0)
    steps.push({
      key: 'extract',
      status: 'done',
      detail: total === 0
        ? '확실한 내용을 못 찾아 인박스로 보낸 건 없어요.'
        : `${out.suggested}건을 인박스로 보냈어요.`
          + (out.dropped > 0 ? ` (근거가 분명하지 않은 ${out.dropped}건은 뺐습니다)` : ''),
    })
  } catch (e) {
    // "먼저 전사를 넣어 주세요" 는 실패가 아니라 **아직 할 게 없는 것**이다
    const msg = why(e, 'AI가 읽지 못했어요.')
    const nothingToRead = e instanceof CrmError && e.code === 'VALIDATION_FAILED'
    steps.push({ key: 'extract', status: nothingToRead ? 'skipped' : 'failed', detail: msg })
  }

  // ── ④ 그래서 아직 모르는 것. **앞 단계가 어떻게 됐든 반드시 답한다**
  let questions: OpenQuestion[] = []
  try {
    questions = await listOpenQuestions(db, {
      meetingId,
      companyId: meeting.companyId,
      dealId: meeting.dealId,
    })
  } catch {
    // 질문을 못 만든 것이 미팅 종료를 실패로 만들지 않는다
    questions = []
  }

  return { steps, endedAt, axes, suggested, dropped, questions }
}
