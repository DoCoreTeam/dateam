/**
 * 기기가 만든 회의를 서버로 건넨다 (SSOT)
 *
 * **왜 생겼나 (사용자 지시 2026-09-30)**: *"어떤 상황이든 누락되는게 발생되면 안되는거야"*
 *
 * 연결이 없을 때 시작한 녹음은 `local_…` 밑에 쌓인다(`begin-recording`).
 * 연결이 돌아오면 **회의를 서버에 만들고, 그 밑으로 구간을 옮기고, 올린다.**
 * 이 셋 중 하나라도 빠지면 그 회의의 소리는 기기에만 남고 아무도 못 본다.
 *
 * 규율 다섯 —
 *   ① 한 번 만든 회의는 **다시 안 만든다.** 만들자마자 서버 id 를 대기 회의에 적어 두고,
 *      옮기기가 실패해도 다음 판은 만들기를 건너뛴다. 안 그러면 같은 회의가 두 벌이 된다
 *   ② 옮기기 전에는 **대기 목록에서 안 지운다.** 지우면 그 구간들의 주인이 없어진다
 *   ③ **녹음 중인 회의는 안 건넌다.** 건너는 동안에도 구간이 계속 쌓이므로,
 *      옮기고 지우면 그 뒤에 들어온 구간이 고아가 된다. 녹음이 끝난 뒤에 건넌다
 *      다른 탭에서 도는 녹음도 미룬다(2026-10-26 실측)
 *   ④ 시작 시각은 **녹음을 켠 순간**으로 간다. 지금 시각으로 만들면 오전 회의가 오후가 된다
 *   ⑤ 녹음 중에 기기에 적은 기록(`local-memo`)은 구간을 옮긴 뒤 회의노트 본문으로 올린다.
 *      올라가야 기록을 지우고, 올라가야 대기 목록에서 지운다. 못 올렸으면 대기 회의를 남겨
 *      다음 판이 다시 올린다. 다음 판은 ①로 만들기를 건너뛰고, 옮기기는 이미 옮긴 구간이
 *      없으니 아무것도 안 한다(`rekeyNote` 가 0 을 돌려준다). 그래서 따로 도는 길이 필요 없다
 */

import { startMeeting, type StartMeetingInput, type StartedMeeting } from '../crm/ui/start-meeting.ts'
import {
  listPendingMeetings, markPendingMeetingCreated, removePendingMeeting,
  rememberHandover, serverIdFor,
  type PendingMeeting,
} from './local-meeting.ts'
import { rekeyNote } from './blob-store.ts'
import { liveLeasedNoteIds } from './recording-lease.ts'
import { readLocalMemo, removeLocalMemo, memoTextToHtml } from './local-memo.ts'

/** 작업대 편집기와 같은 창구, 주인만 고칠 수 있다(`app/api/meeting-notes/[id]` PATCH) */
async function uploadNoteBody(noteId: string, bodyHtml: string): Promise<void> {
  const res = await fetch(`/api/meeting-notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bodyHtml }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new Error(typeof body.error === 'string' ? body.error : '기록을 올리지 못했어요')
  }
}

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
  /** 지역 id 와 서버 id 짝, 대기 회의를 지운 뒤에도 남는다 */
  remember?: (localId: string, serverNoteId: string) => void
  serverIdFor?: (localId: string) => string | null
  rekey?: (fromNoteId: string, toNoteId: string) => Promise<number>
  /** 지금 녹음이 붙어 있는 회의 — 이것만은 건너지 않는다 */
  activeNoteId?: string | null
  /** 이 탭과 다른 탭에서 녹음이 붙어 있는 회의들 (target, remote) */
  activeNoteIds?: (string | null | undefined)[]
  /** 녹음 임대가 살아 있는 회의, 소식이 끊긴 탭의 녹음도 이걸로 안다 */
  leased?: () => string[]
  isOnline?: () => boolean
  /** 기기에 적은 기록, 없으면 빈 글 */
  readMemo?: (localId: string) => string
  clearMemo?: (localId: string) => void
  /** 회의노트 본문을 올린다, 2xx 가 아니면 던진다 */
  uploadBody?: (noteId: string, bodyHtml: string) => Promise<void>
}

export async function reconcilePendingMeetings(deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  const create = deps.create ?? startMeeting
  const list = deps.list ?? listPendingMeetings
  const markCreated = deps.markCreated ?? markPendingMeetingCreated
  const forget = deps.forget ?? removePendingMeeting
  const rekey = deps.rekey ?? rekeyNote
  const remember = deps.remember ?? ((localId: string, noteId: string) => { rememberHandover(localId, noteId) })
  const pairedId = deps.serverIdFor ?? ((localId: string) => serverIdFor(localId))
  const readMemo = deps.readMemo ?? ((localId: string) => readLocalMemo(localId))
  const clearMemo = deps.clearMemo ?? ((localId: string) => { removeLocalMemo(localId) })
  const uploadBody = deps.uploadBody ?? uploadNoteBody
  const isOnline = deps.isOnline
    ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))

  if (!isOnline()) return { moved: 0, failed: [], deferred: 0, skipped: true }

  const rows = list()
  if (rows.length === 0) return { moved: 0, failed: [], deferred: 0, skipped: false }

  const recording = new Set<string>(
    [deps.activeNoteId, ...(deps.activeNoteIds ?? []), ...(deps.leased ?? liveLeasedNoteIds)()]
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )

  let moved = 0
  let deferred = 0
  const failed: ReconcileResult['failed'] = []

  for (const m of rows) {
    // ③ 아직 녹음 중이다. 실패가 아니라 미루는 것이다
    if (recording.has(m.localId)) { deferred += 1; continue }

    try {
      // ① 이미 만들었으면 다시 안 만든다, 대기 회의에 없어도 짝이 남아 있으면 그것을 쓴다
      let noteId = m.serverNoteId ?? pairedId(m.localId)
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
        remember(m.localId, noteId)
      }

      // ② 옮기고 나서 지운다
      await rekey(m.localId, noteId)
      // ⑤ 기록을 올린 뒤에 지운다, 실패하면 던져서 대기 회의와 기록이 둘 다 남는다
      const html = memoTextToHtml(readMemo(m.localId))
      if (html) {
        await uploadBody(noteId, html)
        clearMemo(m.localId)
      }
      forget(m.localId)
      moved += 1
    } catch (e) {
      // **대기 목록에서 안 지운다.** 지우면 그 회의는 영영 안 올라간다
      failed.push({ localId: m.localId, error: e instanceof Error ? e.message : '회의를 만들지 못했어요' })
    }
  }

  return { moved, failed, deferred, skipped: false }
}
