/**
 * 못 올린 녹음 구간을 다시 올린다 (SSOT)
 *
 * **왜 따로 뽑았나**: 올리는 일이 두 곳에서 일어난다 —
 * 녹음 중(`recording-context`)과 **연결이 돌아왔을 때**. 두 벌로 두면
 * 한쪽만 고쳐서 "녹음 중에는 재시도가 되는데 복구 후에는 안 되는" 상태가 된다.
 *
 * **아무것도 안 눌러도 올라간다.** 사용자는 회의를 마치고 이동 중이다 —
 * 그때 "다시 시도" 버튼을 찾아 누르라고 하면 아무도 안 누른다.
 *
 * **실패를 조용히 넘기지 않는다.** 5개 중 2개가 실패하면 그 사실을 돌려주고,
 * 화면이 *"구간 3을 올리지 못했습니다 · 다시 시도"* 라고 말한다.
 * 그리고 **원본은 기기에 그대로 둔다** — 성공한 것만 지운다.
 */

import * as blobStore from './blob-store.ts'
import { isLocalNoteId } from './local-meeting.ts'

export interface SyncResult {
  /** 올린 구간 수 */
  uploaded: number
  /** 못 올린 구간 — 화면이 이름으로 말한다 */
  failed: { noteId: string; partIdx: number; error: string }[]
  /** 시도하지 않음(오프라인이거나 저장소 미지원) */
  skipped: boolean
  /**
   * 아직 서버로 안 건너간 회의의 구간 수.
   *
   * **0 이 아니면 아직 잃을 것이 남아 있다.** 이 숫자를 안 돌려주면 화면이
   * 「올릴 것 없음」이라고 말하게 되고, 그건 거짓이다.
   */
  waitingLocal: number
}

/** 구간 하나 올리기 — 녹음 중 경로와 복구 경로가 **같은 요청**을 쓴다 */
export async function uploadOnePart(
  noteId: string, partIdx: number, durationSec: number, blob: Blob,
): Promise<void> {
  const form = new FormData()
  form.append('audio', blob, `part-${partIdx}.webm`)
  form.append('partIdx', String(partIdx))
  form.append('durationSec', String(durationSec))
  const res = await fetch(`/api/meeting-notes/${noteId}/recordings`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? '녹음을 올리지 못했어요')
  }
}

/**
 * 기기에 남은 것을 전부 올린다.
 *
 * **하나가 실패해도 나머지는 계속한다** — 구간 3이 안 올라간다고 4·5까지 멈추면
 * 회의 뒷부분이 통째로 안 올라간다.
 */
export async function syncPendingParts(): Promise<SyncResult> {
  if (!blobStore.isSupported()) return { uploaded: 0, failed: [], skipped: true, waitingLocal: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { uploaded: 0, failed: [], skipped: true, waitingLocal: 0 }
  }

  const pending = await blobStore.listPending().catch(() => [])
  if (pending.length === 0) return { uploaded: 0, failed: [], skipped: false, waitingLocal: 0 }

  let uploaded = 0
  let waitingLocal = 0
  const failed: SyncResult['failed'] = []

  for (const p of pending) {
    /*
      아직 서버로 안 건너간 회의다(`reconcile` 이 할 일). 여기서 올리면 없는 주소로 가서
      404 를 받고 시도 횟수만 쌓인다 — 그러면 화면에 뜨는 사유가 거짓이 된다.
    */
    if (isLocalNoteId(p.noteId)) { waitingLocal += 1; continue }
    try {
      await uploadOnePart(p.noteId, p.partIdx, p.durationSec, p.blob)
      await blobStore.remove(p.noteId, p.partIdx)
      uploaded += 1
    } catch (e) {
      const error = e instanceof Error ? e.message : '올리지 못했어요'
      await blobStore.markTried(p.noteId, p.partIdx, error).catch(() => {})
      failed.push({ noteId: p.noteId, partIdx: p.partIdx, error })
    }
  }

  return { uploaded, failed, skipped: false, waitingLocal }
}
