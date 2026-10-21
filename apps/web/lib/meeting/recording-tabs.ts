/**
 * 다른 탭의 녹음 — **탭끼리 녹음 상태를 알린다.**
 *
 * 사용자 지적(2026-10-21): 녹음하면서 다른 미팅 기록을 보려고 새 탭을 열었다.
 * 녹음 세션은 탭 하나의 셸에 산다(`recording-context.tsx`). 그래서 새 탭은 녹음 중인 줄 몰랐고,
 * 「동시 녹음은 1건」 잠금이 탭 안에서만 걸려 새 탭에서 녹음을 하나 더 시작할 수 있었다.
 * 둘이 돌면 올라간 구간이 어느 회의 것인지 사람이 가릴 수 없다.
 *
 * 같은 출처의 탭끼리 BroadcastChannel 로 **회의 이름·주소·경과 초·상태만** 나눈다.
 * 소리나 구간은 나누지 않는다. 녹음은 여전히 시작한 탭 하나가 들고 있다.
 *
 * 이 파일은 순수 계산과 얇은 채널 하나다 — 판정을 화면에 두면 실브라우저 말고 검증할 수단이 없다.
 */

export const RECORDING_CHANNEL = 'ax-recording'

/** 녹음 중인 탭이 이만큼마다 「아직 녹음 중」을 알린다 */
export const HEARTBEAT_MS = 2_000
/** 이만큼 소식이 없으면 그 탭은 닫혔거나 멈춘 것으로 본다. 알림 두 번을 놓쳐도 버틴다 */
export const STALE_MS = 6_000

export type RemoteRecordingState = 'recording' | 'paused' | 'stopping'

export interface RemoteRecording {
  tabId: string
  noteId: string
  title: string
  href: string
  state: RemoteRecordingState
  /** 보낸 순간의 경과 초 */
  elapsedSec: number
  /** 보낸 시각(ms) */
  at: number
}

export type RecordingTabMessage =
  | ({ type: 'live' } & RemoteRecording)
  | { type: 'gone'; tabId: string }
  /** 새로 열린 탭이 「지금 녹음 중인 탭 있나」를 묻는다 — 다음 알림까지 2초를 안 기다리게 */
  | { type: 'ask'; tabId: string }

const STATES: RemoteRecordingState[] = ['recording', 'paused', 'stopping']

/** 받은 소식을 읽는다. 모양이 틀리면 버린다 — 같은 출처라도 옛 판의 탭이 섞여 있을 수 있다 */
export function parseTabMessage(raw: unknown): RecordingTabMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.tabId !== 'string' || !o.tabId) return null
  if (o.type === 'gone' || o.type === 'ask') return { type: o.type, tabId: o.tabId }
  if (o.type !== 'live') return null
  if (typeof o.noteId !== 'string' || typeof o.title !== 'string' || typeof o.href !== 'string') return null
  if (!STATES.includes(o.state as RemoteRecordingState)) return null
  if (typeof o.elapsedSec !== 'number' || typeof o.at !== 'number') return null
  return {
    type: 'live', tabId: o.tabId, noteId: o.noteId, title: o.title, href: o.href,
    state: o.state as RemoteRecordingState, elapsedSec: o.elapsedSec, at: o.at,
  }
}

/** 소식 하나를 반영한 새 표. 원래 표는 건드리지 않는다 */
export function applyTabMessage(
  table: ReadonlyMap<string, RemoteRecording>,
  msg: RecordingTabMessage,
  selfTabId: string,
): Map<string, RemoteRecording> {
  const next = new Map(table)
  if (msg.tabId === selfTabId) return next
  if (msg.type === 'gone') next.delete(msg.tabId)
  if (msg.type === 'live') {
    const { type: _type, ...rec } = msg
    next.set(msg.tabId, rec)
  }
  return next
}

/** 지금 다른 탭에서 돌고 있는 녹음. 오래된 소식은 없는 것으로 본다 */
export function activeRemote(table: ReadonlyMap<string, RemoteRecording>, now: number): RemoteRecording | null {
  let best: RemoteRecording | null = null
  for (const r of table.values()) {
    if (now - r.at > STALE_MS) continue
    if (!best || r.at > best.at) best = r
  }
  return best
}

/** 다른 탭 녹음의 지금 경과 초 — 멈춰 있으면 보낸 값 그대로 */
export function remoteElapsedSec(r: RemoteRecording, now: number): number {
  if (r.state !== 'recording') return r.elapsedSec
  return r.elapsedSec + Math.max(0, Math.floor((now - r.at) / 1000))
}

/** 탭마다 다른 이름. 새로고침하면 새 탭으로 본다 */
export function newTabId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 채널을 연다. 이 브라우저가 못 하면 null — 그때는 예전처럼 탭 안에서만 잠근다 */
export function openRecordingChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(RECORDING_CHANNEL)
  } catch {
    return null
  }
}
