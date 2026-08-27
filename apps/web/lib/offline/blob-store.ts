/**
 * 녹음 구간 로컬 보관 — **저장 = 기기에 쓴 순간** (SSOT)
 *
 * **왜 생겼나**: 업로드가 실패하면 그 구간이 **영원히 사라졌다.**
 * `use-recorder.ts:150` 의 `catch` 가 상태만 `'failed'` 로 바꾸고 blob 을 버렸다 —
 * 재시도도 로컬 보관도 없었다. 회의실 와이파이가 불안정하면 **중간 10분이 통째로** 없어진다.
 * 사용자는 「올리지 못함」 배지만 보고, 그게 "나중에 다시 올라간다"는 뜻인 줄 안다.
 *
 * **순서를 뒤집는다.** 예전엔 `녹음 → 업로드`(실패하면 끝)였다.
 * 이제는 **`녹음 → 로컬에 쓰기 → 업로드 → 성공한 것만 지우기`** 다.
 * 사용자 지시(2026-08-27): *"녹음 하는것도 로컬에서 우선 저장을 하는 방식으로 하는게 맞는거 같아"*
 *
 * **왜 IndexedDB 인가**: `localStorage` 는 문자열만 담고 5MB 안팎이다.
 * 10분 구간 하나가 이미 5~10MB 라 들어가지 않는다. Blob 을 그대로 담을 수 있는 것은 여기뿐이다.
 *
 * **브라우저가 지울 수 있다**(결정 B). 공간이 부족하면 IndexedDB 는 **경고 없이** 비워진다.
 * 그래서 `requestPersistence()` 로 영구 보관을 요청하고, 거부되면 **화면이 그렇게 말한다** —
 * 로컬 우선 저장은 이걸 안 막으면 오히려 더 위험하다("올렸겠지"라고 믿게 되므로).
 *
 * **개인정보**(결정 5): 올린 구간은 **즉시 지운다.** 못 올린 것도 `MAX_KEEP_DAYS` 까지만 둔다 —
 * 노트북을 분실하면 고객사 회의 음성이 통째로 나간다.
 */

const DB_NAME = 'newax-offline'
const DB_VERSION = 1
const STORE = 'recordingParts'

/** 못 올린 구간을 며칠까지 들고 있나 — 주말을 한 번 넘길 수 있는 최소치(결정 5) */
export const MAX_KEEP_DAYS = 7

export interface PendingPart {
  /** `${noteId}:${partIdx}` — 같은 구간을 두 번 넣지 않는다 */
  key: string
  noteId: string
  partIdx: number
  durationSec: number
  blob: Blob
  /** 처음 쓴 시각(ms). 보관 기한을 여기서 잰다 */
  savedAt: number
  /** 올리기를 몇 번 시도했나 — 화면이 "계속 실패 중"을 말할 근거 */
  tries: number
  /** 마지막 실패 이유. 없으면 아직 시도 전 */
  lastError?: string
}

function partKey(noteId: string, partIdx: number): string {
  return `${noteId}:${partIdx}`
}

/** 이 브라우저가 담을 수 있나 — 없으면 예전처럼 곧장 업로드만 한다(기능이 죽지는 않는다) */
export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        // 회의별로 모아 보기 위해 — "이 회의의 못 올린 구간"을 세는 자리가 화면에 있다
        store.createIndex('noteId', 'noteId', { unique: false })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('로컬 저장소를 열지 못했어요'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('로컬 저장소 작업이 실패했어요'))
  }))
}

/**
 * 구간을 기기에 쓴다. **업로드보다 먼저 부른다.**
 *
 * 여기서 실패하면 업로드도 시도하지 않을 이유는 없다 — 부르는 쪽이 삼키고 진행한다.
 * 다만 **삼켰다는 사실은 남긴다**(로컬 보관 없이 도는 중이라는 뜻이므로).
 */
export async function put(part: Omit<PendingPart, 'key' | 'savedAt' | 'tries'>): Promise<void> {
  const row: PendingPart = {
    ...part,
    key: partKey(part.noteId, part.partIdx),
    savedAt: Date.now(),
    tries: 0,
  }
  await tx('readwrite', (s) => s.put(row))
}

/** 올린 구간은 **즉시 지운다** — 기기에 남기지 않는다(결정 5) */
export async function remove(noteId: string, partIdx: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(partKey(noteId, partIdx)))
}

/** 아직 못 올린 것 전부 — 오래된 것부터 */
export async function listPending(): Promise<PendingPart[]> {
  const all = await tx<PendingPart[]>('readonly', (s) => s.getAll() as IDBRequest<PendingPart[]>)
  return all.sort((a, b) => a.savedAt - b.savedAt)
}

/** 이 회의의 못 올린 구간 수 — 화면이 "올릴 것 N" 을 말할 근거 */
export async function countPending(noteId?: string): Promise<number> {
  const all = await listPending()
  return noteId ? all.filter((p) => p.noteId === noteId).length : all.length
}

/** 시도 기록 — 몇 번 실패했는지 보여야 "계속 안 되는 중"을 사람이 안다 */
export async function markTried(noteId: string, partIdx: number, error: string): Promise<void> {
  const key = partKey(noteId, partIdx)
  const row = await tx<PendingPart | undefined>('readonly', (s) => s.get(key) as IDBRequest<PendingPart | undefined>)
  if (!row) return
  await tx('readwrite', (s) => s.put({ ...row, tries: row.tries + 1, lastError: error }))
}

/**
 * 보관 기한이 지난 것 — **지우지 않고 알려만 준다.**
 *
 * 자동으로 지우면 사용자가 모르는 사이에 회의 하나가 사라진다.
 * 화면이 먼저 말하고, 사람이 확인한 뒤에 `remove` 를 부른다(결정 5).
 */
export async function listExpired(now: number = Date.now()): Promise<PendingPart[]> {
  const limit = now - MAX_KEEP_DAYS * 24 * 60 * 60 * 1000
  return (await listPending()).filter((p) => p.savedAt < limit)
}

/**
 * 브라우저에 영구 보관을 요청한다(결정 B).
 *
 * 거부될 수 있다 — 그때는 **거부됐다고 말한다.** 조용히 넘어가면
 * "기기에 저장됨"이라는 화면 문구가 거짓이 된다.
 */
export async function requestPersistence(): Promise<{ persisted: boolean; reason?: string }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { persisted: false, reason: '이 브라우저는 영구 보관을 지원하지 않아요' }
  }
  try {
    if (await navigator.storage.persisted?.()) return { persisted: true }
    const ok = await navigator.storage.persist()
    return ok
      ? { persisted: true }
      : { persisted: false, reason: '이 브라우저가 저장을 보장하지 않아요 — 연결되는 대로 올려 주세요' }
  } catch {
    return { persisted: false, reason: '영구 보관을 확인하지 못했어요' }
  }
}

/** 남은 공간(바이트). 모르면 null — **모르는 것을 0 으로 말하지 않는다** */
export async function freeBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const { quota, usage } = await navigator.storage.estimate()
    if (typeof quota !== 'number' || typeof usage !== 'number') return null
    return Math.max(0, quota - usage)
  } catch {
    return null
  }
}

/** 10분 구간 하나가 대략 이만큼 — 시작 전에 공간이 되는지 볼 기준 */
export const PART_BYTES_ESTIMATE = 10 * 1024 * 1024
