/**
 * 기기가 만든 회의를 서버로 건넨다 (SSOT)
 *
 * **왜 생겼나 (사용자 지시 2026-09-30)**: *"어떤 상황이든 누락되는게 발생되면 안되는거야"*
 *
 * 연결이 없을 때 시작한 녹음은 `local_…` 밑에 쌓인다(`begin-recording`).
 * 연결이 돌아오면 **회의를 서버에 만들고, 그 밑으로 구간을 옮기고, 올린다.**
 * 이 셋 중 하나라도 빠지면 그 회의의 소리는 기기에만 남고 아무도 못 본다.
 *
 * 규율 넷 —
 *   ① 한 번 만든 회의는 **다시 안 만든다.** 만들자마자 서버 id 를 대기 회의에 적어 두고,
 *      옮기기가 실패해도 다음 판은 만들기를 건너뛴다. 안 그러면 같은 회의가 두 벌이 된다
 *   ② 옮기기 전에는 **대기 목록에서 안 지운다.** 지우면 그 구간들의 주인이 없어진다
 *   ③ **녹음 중인 회의는 안 건넌다.** 건너는 동안에도 구간이 계속 쌓이므로,
 *      옮기고 지우면 그 뒤에 들어온 구간이 고아가 된다. 녹음이 끝난 뒤에 건넌다
 *   ④ 시작 시각은 **녹음을 켠 순간**으로 간다. 지금 시각으로 만들면 오전 회의가 오후가 된다
 */

import { startMeeting, type StartMeetingInput, type StartedMeeting } from '../crm/ui/start-meeting.ts'
import {
  listPendingMeetings, markPendingMeetingCreated, removePendingMeeting,
  type PendingMeeting,
} from './local-meeting.ts'
import { rekeyNote } from './blob-store.ts'

export interface ReconcileResult {
  /** 서버로 건너간 회의 수 */
  moved: number
  /** 건너지 못한 회의 — 대기 목록에 **그대로 남아 있다** */
  failed: { localId: string; error: string }[]
  /** 녹음 중이라 미룬 회의 수 — 실패가 아니다 */
  deferred: number
  /** 시도하지 않음(오프라인) */
  skipped: boolean
}

export interface ReconcileDeps {
  create?: (input: StartMeetingInput) => Promise<StartedMeeting>
  list?: (now?: number) => PendingMeeting[]
  markCreated?: (localId: string, serverNoteId: string) => boolean
  forget?: (localId: string) => void
  rekey?: (fromNoteId: string, toNoteId: string) => Promise<number>
  /** 지금 녹음이 붙어 있는 회의 — 이것만은 건너지 않는다 */
  activeNoteId?: string | null
  isOnline?: () => boolean
}

export async function reconcilePendingMeetings(deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  const create = deps.create ?? startMeeting
  const list = deps.list ?? listPendingMeetings
  const markCreated = deps.markCreated ?? markPendingMeetingCreated
  const forget = deps.forget ?? removePendingMeeting
  const rekey = deps.rekey ?? rekeyNote
  const isOnline = deps.isOnline
    ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))

  if (!isOnline()) return { moved: 0, failed: [], deferred: 0, skipped: true }

  const rows = list()
  if (rows.length === 0) return { moved: 0, failed: [], deferred: 0, skipped: false }

  let moved = 0
  let deferred = 0
  const failed: ReconcileResult['failed'] = []

  for (const m of rows) {
    // ③ 아직 녹음 중이다. 실패가 아니라 미루는 것이다
    if (deps.activeNoteId && m.localId === deps.activeNoteId) { deferred += 1; continue }

    try {
      // ① 이미 만들었으면 다시 안 만든다
      let noteId = m.serverNoteId ?? null
      if (!noteId) {
        /*
          ④ 시작 시각을 그대로 되살린다. `buildStartBody` 가 `now` 의 KST 벽시계로
          제목과 시각을 짓기 때문에, 그때의 순간을 넘기면 그때의 값이 그대로 나온다.
          여기서 따로 지으면 회의 이름이 「언제 올렸나」에 따라 갈린다.
        */
        const made = await create({
          dealId: m.dealId,
          companyId: m.companyId,
          now: new Date(m.startedAt),
        })
        noteId = made.noteId
        markCreated(m.localId, noteId)
      }

      // ② 옮기고 나서 지운다
      await rekey(m.localId, noteId)
      forget(m.localId)
      moved += 1
    } catch (e) {
      // **대기 목록에서 안 지운다.** 지우면 그 회의는 영영 안 올라간다
      failed.push({ localId: m.localId, error: e instanceof Error ? e.message : '회의를 만들지 못했어요' })
    }
  }

  return { moved, failed, deferred, skipped: false }
}
