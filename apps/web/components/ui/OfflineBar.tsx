'use client'

// components/ui/OfflineBar.tsx — 연결 상태와 못 올린 것
//
// **왜 셸에 두나**: 회의는 이동 중에 끊긴다. 그때 사용자가 보는 화면이 어디일지 모른다.
// 어느 화면에 있든 **"앱이 고장난 게 아니라 연결이 없는 것"** 이라고 말해 줘야 한다.
//
// **아무것도 안 눌러도 올라간다**: 연결이 돌아오면 스스로 올린다.
// 회의를 마치고 이동 중인 사람에게 "다시 시도"를 찾아 누르라고 하면 아무도 안 누른다.
//
// **실패를 조용히 넘기지 않는다**: 5개 중 2개가 실패하면 그 사실을 말하고
// **원본은 기기에 그대로 둔다**. 성공한 것만 지운다.

import { useCallback, useEffect, useState } from 'react'
import { CloudOff, CloudUpload, CircleAlert, Check } from 'lucide-react'
import * as blobStore from '@/lib/offline/blob-store'
import { syncPendingParts } from '@/lib/offline/sync-parts'
import { SYNC_STATUS_META, type SyncStatusKey } from '@/lib/offline/ui/sync-status'
import styles from './offline-bar.module.css'

const ICON: Record<SyncStatusKey, React.ReactNode> = {
  OFFLINE: <CloudOff size={14} aria-hidden />,
  QUEUED: <CloudUpload size={14} aria-hidden />,
  SYNCING: <CloudUpload size={14} aria-hidden />,
  SYNCED: <Check size={14} aria-hidden />,
  FAILED: <CircleAlert size={14} aria-hidden />,
}

/** 올림 완료를 몇 초 보여 주고 사라지나 — 남아 있으면 그때부터는 장식이다 */
const DONE_MS = 4000

export default function OfflineBar() {
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [status, setStatus] = useState<SyncStatusKey | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!blobStore.isSupported()) return
    setPending(await blobStore.countPending().catch(() => 0))
  }, [])

  /** 올린다. 스스로도 부르고, 「다시 시도」도 이걸 부른다 */
  const sync = useCallback(async () => {
    if (!blobStore.isSupported()) return
    const before = await blobStore.countPending().catch(() => 0)
    if (before === 0) return

    setStatus('SYNCING')
    setDetail(null)
    const r = await syncPendingParts()
    await refresh()

    if (r.skipped) { setStatus(null); return }
    if (r.failed.length > 0) {
      setStatus('FAILED')
      // 무엇이 안 올라갔는지 **숫자가 아니라 이름으로** 말한다
      setDetail(`구간 ${r.failed.map((f) => f.partIdx + 1).join('·')}`)
      return
    }
    setStatus('SYNCED')
    setDetail(null)
    window.setTimeout(() => setStatus(null), DONE_MS)
  }, [refresh])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refresh()

    const goOnline = () => { setOnline(true); void sync() }
    const goOffline = () => { setOnline(false); setStatus('OFFLINE'); void refresh() }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // 처음 열 때도 한 번 — 지난 세션에서 못 올린 것이 남아 있을 수 있다
    if (navigator.onLine) void sync()
    else setStatus('OFFLINE')

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refresh, sync])

  // 연결도 멀쩡하고 밀린 것도 없으면 아무 말도 안 한다 — 늘 떠 있으면 아무도 안 본다
  const key: SyncStatusKey | null = !online ? 'OFFLINE'
    : status ?? (pending > 0 ? 'QUEUED' : null)
  if (!key) return null

  const meta = SYNC_STATUS_META[key]

  return (
    <div className={styles.bar} data-status={meta.status} role="status">
      {ICON[key]}
      <span className={styles.label}>{meta.label}</span>
      {key === 'OFFLINE' && pending > 0 && (
        <span className={styles.detail}>이 기기에 {pending}건 저장해 뒀어요</span>
      )}
      {key === 'QUEUED' && <span className={styles.detail}>{pending}건</span>}
      {detail && <span className={styles.detail}>{detail}</span>}
      {key === 'FAILED' && (
        <button type="button" className={styles.retry} onClick={() => void sync()}>
          다시 시도
        </button>
      )}
    </div>
  )
}
