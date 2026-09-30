/**
 * 기기가 먼저 만드는 회의 — 오프라인 녹음의 입구 (SSOT)
 *
 * **왜 생겼나 (사용자 지시 2026-09-30)**: *"어떤 상황이든 누락되는게 발생되면 안되는거야 …
 * 오프라인에서도 되게 만들어 충분히 가능할것 같은데 로컬스토리지 이용하면 되니깐"*.
 *
 * 받아 적는 층은 이미 오프라인을 견딘다 — `blob-store` 가 구간을 기기에 먼저 쓰고
 * 못 올린 것을 들고 있다. 그런데 **입구가 못 견뎠다.** 「녹음 시작」이 서버에 회의를
 * 먼저 만들어야 해서, 연결이 없으면 그 한 번을 못 넘고 녹음이 아예 시작되지 않았다.
 *
 * 그래서 id 를 **기기가 먼저 만든다.** 서버는 연결이 돌아온 뒤 따라온다(`reconcile`).
 *
 * **여기는 `localStorage` 를 쓴다.** 소리는 못 담지만(그래서 구간은 IndexedDB 다)
 * 제목·시각처럼 짧은 글자는 이쪽이 맞다 — 동기로 읽히고, 탭이 죽어도 남는다.
 *
 * **개인정보**(blob-store 결정 5 와 같은 규율): 회의 제목이 기기에 남는다.
 * 서버로 건너간 회의는 **즉시 지우고**, 못 건너간 것도 `MAX_KEEP_DAYS` 까지만 센다.
 */

import { MAX_KEEP_DAYS } from './blob-store.ts'

/**
 * 기기가 만든 id 라는 표시.
 *
 * 서버 id 와 **확실히** 갈려야 한다. 섞이면 `/api/meeting-notes/{id}/recordings` 로
 * 없는 주소에 올리게 되고, 시도 횟수만 쌓이면서 사유가 거짓이 된다.
 * 이 저장소의 서버 id 는 uuid 와 cuid 두 모양인데 둘 다 `_` 를 안 쓴다.
 */
export const LOCAL_ID_PREFIX = 'local_'

/** 대기 회의를 담는 자리 */
export const PENDING_KEY = 'newax.pending-meetings'

export interface PendingMeeting {
  localId: string
  title: string
  /**
   * 녹음을 켠 순간의 KST 벽시계 앵커.
   *
   * **연결이 돌아온 시각이 아니다.** 그때 만들면 오전 11시 회의가 오후 2시로 기록된다.
   * 누락은 아니지만 왜곡이라 같은 자리에서 막는다.
   */
  startedAt: string
  dealId: string | null
  companyId: string | null
  /** 기기에 쓴 시각(ms). 보관 기한을 여기서 잰다 */
  savedAt: number
}

export function newLocalNoteId(): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${LOCAL_ID_PREFIX}${rand}`
}

export function isLocalNoteId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_ID_PREFIX)
}

/** 안 주면 브라우저 것. 시험은 흉내낸 것을 넘긴다 */
function pick(store?: Storage): Storage | null {
  if (store) return store
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 사파리 프라이빗 등에서 접근 자체가 던진다
    return null
  }
}

function readAll(store?: Storage): PendingMeeting[] {
  const s = pick(store)
  if (!s) return []
  try {
    const raw = s.getItem(PENDING_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // 망가진 내용이 들어 있어도 죽지 않는다 — 한 번 깨지면 영영 못 올리게 된다
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is PendingMeeting =>
      !!m && typeof (m as PendingMeeting).localId === 'string')
  } catch {
    return []
  }
}

function writeAll(rows: PendingMeeting[], store?: Storage): boolean {
  const s = pick(store)
  if (!s) return false
  try {
    s.setItem(PENDING_KEY, JSON.stringify(rows))
    return true
  } catch {
    // **조용히 성공하지 않는다.** 된 줄 알고 녹음하면 그게 잃는 것이다
    return false
  }
}

function isExpired(m: PendingMeeting, now: number): boolean {
  return now - m.savedAt > MAX_KEEP_DAYS * 86_400_000
}

/** 아직 서버로 안 건너간 회의 — 기한이 지난 것은 빼고 준다 */
export function listPendingMeetings(now: number = Date.now(), store?: Storage): PendingMeeting[] {
  return readAll(store).filter((m) => !isExpired(m, now))
}

/** 기한이 지난 것 — **말없이 사라지지 않게** 세는 자리를 따로 둔다 */
export function expiredPendingMeetings(now: number = Date.now(), store?: Storage): PendingMeeting[] {
  return readAll(store).filter((m) => isExpired(m, now))
}

/**
 * 대기 회의를 더한다. 저장할 수 없으면 **false** 를 준다.
 *
 * 같은 `localId` 는 덮어쓴다 — 두 벌이 되면 서버에도 회의가 두 개 생기고
 * 딜에 붙는 기록도 둘이 된다.
 */
export function addPendingMeeting(m: PendingMeeting, store?: Storage): boolean {
  const rows = readAll(store).filter((x) => x.localId !== m.localId)
  rows.push(m)
  return writeAll(rows, store)
}

/** 서버로 건너갔으면 즉시 지운다(개인정보) */
export function removePendingMeeting(localId: string, store?: Storage): void {
  const rows = readAll(store)
  if (rows.length === 0) return
  writeAll(rows.filter((m) => m.localId !== localId), store)
}
