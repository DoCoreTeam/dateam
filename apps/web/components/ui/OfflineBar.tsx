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

    const goOnline = () => { setOnline(true); setStatus(null); void sync() }
    const goOffline = () => { setOnline(false); setStatus('OFFLINE'); void refresh() }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // **이벤트만 믿지 않는다.** 탭이 배경에 있는 동안 일어난 복구는 `online` 이벤트를
    // 놓치는 일이 잦고(개발 중 StrictMode 재마운트 사이에도 샌다), 한 번 놓치면
    // 배너가 영원히 「연결 없음」에 붙박인다 — 인터넷은 멀쩡한데 화면만 고장난 것처럼 보인다.
    // 그래서 사용자가 화면으로 돌아올 때마다 **다시 잰다**.
    const recheck = () => {
      if (document.visibilityState === 'hidden') return
      const now = navigator.onLine
      setOnline(now)
      if (now) { setStatus((prev) => (prev === 'OFFLINE' ? null : prev)); void sync() }
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)

    // 처음 열 때도 한 번 — 지난 세션에서 못 올린 것이 남아 있을 수 있다
    if (navigator.onLine) void sync()
    else setStatus('OFFLINE')

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [refresh, sync])

  // 연결도 멀쩡하고 밀린 것도 없으면 아무 말도 안 한다 — 늘 떠 있으면 아무도 안 본다.
  //
  // **연결이 없어도 잃을 것이 없으면 말하지 않는다.** 이 줄의 일은
  // 「끊겼지만 당신이 쓴 것은 안전하다」를 말하는 것이다 — 밀린 것이 0건이면 안심시킬 것도 없고,
  // 상시로 뜬 「연결 없음」은 안내가 아니라 **고장 신호로 읽힌다**
  // (실제 지적: "이거 연결 없음 뭐야? 장애인 거 같은데 인터넷 다 연결 되어 있어").
  //
  // 온라인인데 OFFLINE 이 남아 있으면 **버린다** — 상태가 붙박이면 영원히 안 사라진다.
  const live: SyncStatusKey | null = online && status === 'OFFLINE' ? null : status
  const key: SyncStatusKey | null = !online
    ? (pending > 0 ? 'OFFLINE' : null)
    : live ?? (pending > 0 ? 'QUEUED' : null)
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
