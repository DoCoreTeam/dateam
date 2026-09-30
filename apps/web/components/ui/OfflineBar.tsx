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
//
// ── 연결을 무엇으로 판정하나 (v0.10.726, 실측 2026-09-30) ────────────────────
// 예전에는 `navigator.onLine` 하나로 판정했다. 그 값은 **기기에 네트워크가 있나**를 말하지
// **우리 서버가 답하나**를 말하지 않는다. 그래서 서버가 내려간 채 전날 화면이 멀쩡히 떠 있었고,
// 사용자가 「녹음 시작」을 누르고 나서야 죽은 줄 알았다 — 화면에 뜬 말은 「Failed to fetch」였다.
// (그 화면은 딜이 「32일째」라고 적고 있었는데, 그날 서버가 세면 33일째였다.)
//
// 이제는 **보내 보고 답이 왔나**로 판정한다(`lib/offline/reachable`). 그래서 이 줄은
// 두 가지를 갈라 말한다 — 기기가 끊긴 것과, 서버가 안 답하는 것. 사람이 할 일이 다르다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudOff, CloudUpload, CircleAlert, Check, ServerOff } from 'lucide-react'
import * as blobStore from '@/lib/offline/blob-store'
import { syncPendingParts } from '@/lib/offline/sync-parts'
import { SYNC_STATUS_META, type SyncStatusKey } from '@/lib/offline/ui/sync-status'
import { pingServer, nextFailureStreak, isUnreachable } from '@/lib/offline/reachable'
import styles from './offline-bar.module.css'

const ICON: Record<SyncStatusKey, React.ReactNode> = {
  OFFLINE: <CloudOff size={14} aria-hidden />,
  UNREACHABLE: <ServerOff size={14} aria-hidden />,
  QUEUED: <CloudUpload size={14} aria-hidden />,
  SYNCING: <CloudUpload size={14} aria-hidden />,
  SYNCED: <Check size={14} aria-hidden />,
  FAILED: <CircleAlert size={14} aria-hidden />,
}

/** 올림 완료를 몇 초 보여 주고 사라지나 — 남아 있으면 그때부터는 장식이다 */
const DONE_MS = 4000

/**
 * 얼마나 자주 물어보나.
 *
 * 닿는 동안은 드물게 — 이 창구는 값이 없지만 부르면 서버 한 번이다.
 * **한 번이라도 어긋나면 그때부터 자주** — 여기를 「안 닿는다고 판정한 뒤」로 두면
 * 판정까지 30초 + 30초가 걸린다(실브라우저 실측: 45초 안에 배너가 안 떴다).
 * 살아난 것을 늦게 아는 것도 같은 값으로 빨라진다.
 * **배경 탭에서는 아예 안 묻는다.** 안 보는 화면의 연결 상태는 아무에게도 필요 없다.
 */
const PING_EVERY_MS = 30_000
const PING_EVERY_DOWN_MS = 8_000

export default function OfflineBar() {
  /** 기기 쪽 — 네트워크가 꽂혀 있나 */
  const [online, setOnline] = useState(true)
  /** 서버 쪽 — 실제로 답하나. 이 둘은 다른 질문이다 */
  const [reachable, setReachable] = useState(true)
  const [pending, setPending] = useState(0)
  const [status, setStatus] = useState<SyncStatusKey | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  /** 연속 실패 셈 — 한 번 튄 요청에 경고가 깜빡이면 그 배너는 고장 신호가 된다 */
  const streakRef = useRef(0)
  /** 한 번이라도 어긋났나 — 아직 말하지는 않지만 **자주 묻기 시작한다** */
  const [suspect, setSuspect] = useState(false)
  /** 직전에 끊겨 있었나 — 돌아온 «순간»에만 올리기를 걸기 위해서다 */
  const wasDownRef = useRef(false)

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

  /**
   * 한 번 재고 그 결과를 화면에 반영한다.
   *
   * 기기가 끊겨 있으면 **묻지 않는다** — 답이 뻔하고, 그 상태에서 던지는 요청은
   * 콘솔만 더럽힌다. 대신 곧장 끊긴 것으로 센다.
   */
  const measure = useCallback(async () => {
    const deviceOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    setOnline(deviceOnline)

    const answered = deviceOnline
      ? await pingServer((url, init) => fetch(url, init))
      : false
    streakRef.current = nextFailureStreak(streakRef.current, answered)
    setSuspect(streakRef.current > 0)

    const down = !deviceOnline || isUnreachable(streakRef.current)
    setReachable(!down)

    // 돌아온 «순간»에만 — 닿는 동안 30초마다 올리기를 거는 것은 재는 일이 아니다
    if (!down && wasDownRef.current) {
      setStatus((prev) => (prev === 'OFFLINE' ? null : prev))
      void sync()
    }
    wasDownRef.current = down
  }, [sync])

  useEffect(() => {
    void refresh()
    void measure()

    const goOnline = () => { setOnline(true); setStatus(null); void sync(); void measure() }
    const goOffline = () => { setOnline(false); setReachable(false); setStatus('OFFLINE'); void refresh() }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // **이벤트만 믿지 않는다.** 탭이 배경에 있는 동안 일어난 복구는 `online` 이벤트를
    // 놓치는 일이 잦고(개발 중 StrictMode 재마운트 사이에도 샌다), 한 번 놓치면
    // 배너가 영원히 「연결 없음」에 붙박인다 — 인터넷은 멀쩡한데 화면만 고장난 것처럼 보인다.
    // 그래서 사용자가 화면으로 돌아올 때마다 **다시 잰다**.
    const recheck = () => {
      if (document.visibilityState === 'hidden') return
      void measure()
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [refresh, sync, measure])

  /**
   * 주기적으로 다시 잰다 — **사고는 사용자가 아무것도 안 하는 동안 일어난다.**
   * 어제 열어 둔 탭이 오늘도 멀쩡해 보이는 것이 이 배너가 생긴 이유다.
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void measure()
    }, suspect ? PING_EVERY_DOWN_MS : PING_EVERY_MS)
    return () => window.clearInterval(id)
  }, [measure, suspect])

  // 연결도 멀쩡하고 밀린 것도 없으면 아무 말도 안 한다 — 늘 떠 있으면 아무도 안 본다.
  //
  // **안 닿으면 밀린 것이 0건이어도 말한다.** 예전에는 여기서 「잃을 것이 없으면 조용히」를
  // 걸어 두었는데, 그 규칙은 배너의 일이 「쓴 것은 안전하다」뿐일 때만 맞았다.
  // 지금 이 줄은 하나를 더 말한다 — **지금 보이는 값이 지난 것이다.**
  // 그 사실은 밀린 것이 0건일 때도 참이고, 그때 말 안 해 준 것이 이번 사고였다.
  //
  // 온라인인데 OFFLINE 이 남아 있으면 **버린다** — 상태가 붙박이면 영원히 안 사라진다.
  const live: SyncStatusKey | null = online && status === 'OFFLINE' ? null : status
  const key: SyncStatusKey | null = !online
    ? 'OFFLINE'
    : !reachable
      ? 'UNREACHABLE'
      : live ?? (pending > 0 ? 'QUEUED' : null)
  if (!key) return null

  const meta = SYNC_STATUS_META[key]

  return (
    <div className={styles.bar} data-status={meta.status} role="status">
      {ICON[key]}
      <span className={styles.label}>{meta.label}</span>
      {/*
        이 한 줄이 이번 사고의 답이다 — 화면이 살아 있는 것처럼 보여도 값은 지난 것이다.
        숫자를 못 믿게 만드는 것이 아니라, **언제 것인지** 말해 주는 것이다.
      */}
      {key === 'UNREACHABLE' && (
        <span className={styles.detail}>지금 보이는 값은 마지막으로 받은 것이에요</span>
      )}
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
