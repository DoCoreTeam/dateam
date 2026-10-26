/**
 * 녹음 임대, **어느 탭이 지금 이 회의를 녹음하고 있나** 를 기기에 적는다
 *
 * 왜 생겼나 (실측 2026-10-26): 오프라인에서 시작한 녹음이 도는 동안 연결이 돌아오자
 * **다른 탭**의 OfflineBar 가 그 회의를 서버로 건넸다. 그 탭은 녹음을 들고 있지 않아서
 * 「녹음 중인 회의는 안 건넌다」를 몰랐다. 건넨 뒤 쌓인 구간 6개가 고아가 됐다.
 *
 * 탭끼리의 소식(BroadcastChannel)은 연 뒤에 들어온 것만 안다. 막 열린 탭이나
 * 소식이 끊긴 순간에도 보이도록 **localStorage 에 회의 id 와 시각만** 적는다.
 * 녹음하는 탭이 심장박동마다 다시 쓰고, 끝나면 지운다. 닫힌 탭의 것은 기한이 지나면 빠진다.
 */

import { HEARTBEAT_MS } from '../meeting/recording-tabs.ts'

export const RECORDING_LEASE_KEY = 'newax.recording-lease'

/** 심장박동 열다섯 번(30초), 백그라운드 탭은 타이머가 느려지므로 넉넉히 잡는다 */
export const LEASE_TTL_MS = HEARTBEAT_MS * 15

type LeaseTable = Record<string, number>

/** 안 주면 브라우저 것. 시험은 흉내낸 것을 넘긴다 */
function pick(store?: Storage): Storage | null {
  if (store) return store
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function readTable(store?: Storage): LeaseTable {
  const s = pick(store)
  if (!s) return {}
  try {
    const raw = s.getItem(RECORDING_LEASE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])),
    )
  } catch {
    return {}
  }
}

function writeTable(table: LeaseTable, store?: Storage): void {
  const s = pick(store)
  if (!s) return
  try {
    if (Object.keys(table).length === 0) s.removeItem(RECORDING_LEASE_KEY)
    else s.setItem(RECORDING_LEASE_KEY, JSON.stringify(table))
  } catch {
    // 임대는 미루기 판단의 보탬이다. 못 써도 녹음 자체는 계속 간다
  }
}

/** 녹음 중인 탭이 부른다. 처음 한 번과 심장박동마다 */
export function writeRecordingLease(noteId: string, now: number = Date.now(), store?: Storage): void {
  writeTable({ ...readTable(store), [noteId]: now }, store)
}

/** 녹음이 끝나면 놓는다 */
export function clearRecordingLease(noteId: string, store?: Storage): void {
  const table = readTable(store)
  if (!(noteId in table)) return
  writeTable(Object.fromEntries(Object.entries(table).filter(([id]) => id !== noteId)), store)
}

/** 기한 안에 다시 쓰인 임대의 회의 id, 이 회의들은 지금 어딘가에서 녹음 중이다 */
export function liveLeasedNoteIds(now: number = Date.now(), store?: Storage): string[] {
  return Object.entries(readTable(store))
    .filter(([, at]) => now - at <= LEASE_TTL_MS)
    .map(([id]) => id)
}
