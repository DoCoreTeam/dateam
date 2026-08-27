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

export interface SyncResult {
  /** 올린 구간 수 */
  uploaded: number
  /** 못 올린 구간 — 화면이 이름으로 말한다 */
  failed: { noteId: string; partIdx: number; error: string }[]
  /** 시도하지 않음(오프라인이거나 저장소 미지원) */
  skipped: boolean
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
  if (!blobStore.isSupported()) return { uploaded: 0, failed: [], skipped: true }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { uploaded: 0, failed: [], skipped: true }
  }

  const pending = await blobStore.listPending().catch(() => [])
  if (pending.length === 0) return { uploaded: 0, failed: [], skipped: false }

  let uploaded = 0
  const failed: SyncResult['failed'] = []

  for (const p of pending) {
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

  return { uploaded, failed, skipped: false }
}
