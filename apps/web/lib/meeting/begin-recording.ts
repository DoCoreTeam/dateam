/**
 * 녹음 시작 — **안 닿아도 시작된다** (SSOT)
 *
 * **왜 생겼나 (사용자 지시 2026-09-30)**: *"녹음 자체는 온라인 상태가 아니어도
 * 웹페이지가 열려있으면 할 수 있어야 하는거 아닌가"* ·
 * *"어떤 상황이든 누락되는게 발생되면 안되는거야"*
 *
 * 받아 적는 층은 이미 오프라인을 견딘다(`blob-store` 가 구간을 기기에 먼저 쓴다).
 * 못 견딘 것은 **입구**였다 — 「녹음 시작」이 서버에 회의를 먼저 만들어야 해서,
 * 연결이 없으면 그 한 번을 못 넘고 녹음이 아예 시작되지 않았다.
 *
 * 그래서 여기서 셋으로 가른다.
 *   ① 서버가 답했다 → 예전 그대로
 *   ② 서버가 답했는데 거절했다 → **그 사유를 그대로 올린다.** 권한 문제를 연결 문제로 바꿔 말하지 않는다
 *   ③ 답이 하나도 안 왔다 → 기기가 id 를 만들고, 서버는 연결이 돌아온 뒤 따라온다(`reconcile`)
 *
 * ③ 에 조건 하나: **기기에 담을 수 없으면 시작하지 않는다.**
 * 올리지도 저장하지도 못하는 녹음은 시작한 순간부터 잃는 녹음이고,
 * 그때 화면이 「녹음 중」이라고 말하는 것이 가장 나쁜 거짓말이다.
 */

import { startMeeting, buildStartBody, type StartMeetingInput, type StartedMeeting } from '../crm/ui/start-meeting.ts'
import { ServerUnreachableError } from '../offline/reachable.ts'
import { addPendingMeeting, newLocalNoteId, type PendingMeeting } from '../offline/local-meeting.ts'
import * as blobStore from '../offline/blob-store.ts'

/** 담을 데가 없을 때 하는 말 — 시작하지 않았다는 사실까지 말해야 사람이 다른 수를 쓴다 */
export const CANNOT_KEEP_MESSAGE =
  '이 브라우저에 녹음을 저장할 수 없어 시작하지 않았어요. 연결이 돌아온 뒤 다시 눌러 주세요.'

export type BeginOutcome =
  /** 서버에 회의가 생겼다 — 화면을 작업대로 옮긴다 */
  | { kind: 'server'; id: string; noteId: string }
  /**
   * 기기가 먼저 만들었다 — **화면을 옮기지 않는다.**
   * 없는 주소로 이동하면 오프라인에서 화면이 통째로 죽는다.
   */
  | { kind: 'local'; localId: string; title: string; startedAt: string }

export interface BeginDeps {
  create?: (input: StartMeetingInput) => Promise<StartedMeeting>
  remember?: (m: PendingMeeting) => boolean
  makeId?: () => string
  /** 소리를 기기에 담을 수 있나 — 없으면 오프라인 녹음은 시작하지 않는다 */
  canKeepAudio?: () => boolean
  now?: Date
}

export async function beginRecording(
  input: StartMeetingInput = {},
  deps: BeginDeps = {},
): Promise<BeginOutcome> {
  const create = deps.create ?? startMeeting
  const remember = deps.remember ?? addPendingMeeting
  const makeId = deps.makeId ?? newLocalNoteId
  const canKeepAudio = deps.canKeepAudio ?? blobStore.isSupported
  const now = deps.now ?? new Date()

  try {
    const made = await create(input)
    return { kind: 'server', id: made.id, noteId: made.noteId }
  } catch (e) {
    // 서버가 답하고 거절한 것은 여기서 삼키지 않는다 — 사람이 고쳐야 하는 종류다
    if (!(e instanceof ServerUnreachableError)) throw e
  }

  if (!canKeepAudio()) throw new Error(CANNOT_KEEP_MESSAGE)

  /**
   * 제목·시각은 **서버로 보냈을 값을 그대로** 쓴다.
   * 여기서 따로 지으면 어디서 시작했느냐에 따라 회의 이름이 갈린다(start-meeting 의 이유와 같다).
   */
  const body = buildStartBody({ ...input, now })
  const localId = makeId()
  const kept = remember({
    localId,
    title: String(body.title),
    startedAt: String(body.startedAt),
    dealId: (body.dealId as string | null) ?? null,
    companyId: (body.companyId as string | null) ?? null,
    savedAt: now.getTime(),
  })
  if (!kept) throw new Error(CANNOT_KEEP_MESSAGE)

  return { kind: 'local', localId, title: String(body.title), startedAt: String(body.startedAt) }
}
