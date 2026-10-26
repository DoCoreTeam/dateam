/**
 * 대기 회의 없이 남은 지역 구간을 서버 회의로 입양한다
 *
 * 왜 생겼나 (실측 2026-10-26): 녹음 중에 회의가 서버로 건너가 대기 회의가 지워졌다.
 * 녹음기는 그 뒤에도 `local_…` 밑에 구간 6개를 쌓았고, 건네기(`reconcile`)는
 * 대기 회의만 보므로 그 구간들은 주인 없이 영영 안 올라갔다.
 *
 * 규율
 *   대기 회의가 있는 지역 id 는 건네기 몫이라 손대지 않는다
 *   녹음 중(이 탭, 다른 탭, 녹음 임대) 인 지역 id 는 손대지 않는다
 *   건넨 짝이 있으면 회의를 만들지 않고 그 서버 id 로 옮긴다
 *   만들었으면 **옮기기 전에 짝부터 적는다.** 옮기다 실패해도 다음 판이 다시 만들지 않게
 *   시작 시각은 첫 구간이 닫힌 시각에서 그 길이를 뺀 순간이다. 올린 시각으로 만들면 회의 시각이 틀어진다
 *   여러 탭이 동시에 돌면 회의가 두 벌 되므로 탭 사이 잠금 안에서 돈다
 */

import { startMeeting, type StartMeetingInput, type StartedMeeting } from '../crm/ui/start-meeting.ts'
import { listPending, rekeyNote } from './blob-store.ts'
import {
  isLocalNoteId, listPendingMeetings, rememberHandover, serverIdFor,
} from './local-meeting.ts'
import { liveLeasedNoteIds } from './recording-lease.ts'

/** 건네기와 입양이 같이 쓰는 탭 사이 잠금 이름 */
export const HANDOVER_LOCK = 'newax-offline-handover'

export interface OrphanPart {
  noteId: string
  partIdx: number
  durationSec: number
  savedAt: number
}

export interface AdoptResult {
  /** 서버 회의로 옮긴 지역 회의 수 */
  adopted: number
  /** 옮긴 구간 수 */
  parts: number
  failed: { localId: string; error: string }[]
  /** 시도하지 않음(오프라인) */
  skipped: boolean
}

export interface AdoptDeps {
  listParts?: () => Promise<OrphanPart[]>
  pendingLocalIds?: () => string[]
  activeNoteIds?: (string | null | undefined)[]
  leased?: () => string[]
  serverIdFor?: (localId: string) => string | null
  create?: (input: StartMeetingInput) => Promise<StartedMeeting>
  remember?: (localId: string, serverNoteId: string) => void
  rekey?: (fromNoteId: string, toNoteId: string) => Promise<number>
  isOnline?: () => boolean
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>
}

/** 탭 사이 잠금. 브라우저가 못 주면 그냥 돈다 */
export function withHandoverLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks || typeof locks.request !== 'function') return fn()
  return locks.request(HANDOVER_LOCK, () => fn()) as Promise<T>
}

/** 지역 id 별로 묶는다, 손대면 안 되는 것은 뺀다 */
function groupOrphans(parts: OrphanPart[], untouchable: Set<string>): Map<string, OrphanPart[]> {
  const groups = new Map<string, OrphanPart[]>()
  for (const p of parts) {
    if (!isLocalNoteId(p.noteId) || untouchable.has(p.noteId)) continue
    groups.set(p.noteId, [...(groups.get(p.noteId) ?? []), p])
  }
  return groups
}

/** 녹음을 켠 순간, 구간마다 닫힌 시각에서 길이를 뺀 값 중 가장 이른 것 */
function startedAtOf(parts: OrphanPart[]): Date {
  return new Date(Math.min(...parts.map((p) => p.savedAt - p.durationSec * 1000)))
}

export async function adoptOrphanParts(deps: AdoptDeps = {}): Promise<AdoptResult> {
  const isOnline = deps.isOnline
    ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  if (!isOnline()) return { adopted: 0, parts: 0, failed: [], skipped: true }
  return (deps.withLock ?? withHandoverLock)(() => adoptUnlocked(deps))
}

async function adoptUnlocked(deps: AdoptDeps): Promise<AdoptResult> {
  const listParts = deps.listParts ?? listPending
  const pendingLocalIds = deps.pendingLocalIds ?? (() => listPendingMeetings().map((m) => m.localId))
  const leased = deps.leased ?? liveLeasedNoteIds
  const pairedId = deps.serverIdFor ?? ((id: string) => serverIdFor(id))
  const create = deps.create ?? startMeeting
  const remember = deps.remember ?? ((l: string, n: string) => { rememberHandover(l, n) })
  const rekey = deps.rekey ?? rekeyNote

  const untouchable = new Set<string>(
    [...pendingLocalIds(), ...(deps.activeNoteIds ?? []), ...leased()]
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const groups = groupOrphans(await listParts(), untouchable)

  let adopted = 0
  let moved = 0
  const failed: AdoptResult['failed'] = []
  for (const [localId, parts] of groups) {
    try {
      let noteId = pairedId(localId)
      if (!noteId) {
        const made = await create({ dealId: null, companyId: null, now: startedAtOf(parts) })
        noteId = made.noteId
        remember(localId, noteId)
      }
      moved += await rekey(localId, noteId)
      adopted += 1
    } catch (e) {
      failed.push({ localId, error: e instanceof Error ? e.message : '회의를 만들지 못했어요' })
    }
  }
  return { adopted, parts: moved, failed, skipped: false }
}
