'use client'

/**
 * 녹음 세션 — **화면보다 오래 산다.**
 *
 * **왜 셸로 올렸나.** 예전에는 `useMeetingRecorder`를 회의노트 상세 화면이 직접 들고 있었다.
 * 그래서 라우트를 옮기면 컴포넌트가 언마운트되고, cleanup이 마이크 트랙을 끊었다.
 * 그때 아직 10분 회전이 안 된 **진행 중 구간은 업로드되지 않는다** — 최대 10분이 조용히 사라졌다.
 * 게다가 CRM의 "녹음 시작"은 미팅을 만든 뒤 **반드시 `router.replace`를 했다**(v0.7.588 실측).
 * 즉 그 경로는 구조적으로 녹음을 못 남겼다.
 *
 * `AppShell`은 (member)·(crm)·(ci)·admin 네 표면이 **전부 공유한다.**
 * 그래서 제공자를 거기 **한 번만** 두면 네 표면 어디로 옮겨도 마이크가 계속 돈다.
 * 이게 "같은 플랫폼을 공유해서 여기서도 바로" 라는 지시의 실체다 —
 * 화면을 옮기지 않게 만드는 게 아니라, **옮겨도 일이 안 끊기게** 만드는 것.
 *
 * **동시 녹음은 1건으로 잠근다.** 둘이 돌면 올라간 구간이 어느 회의 것인지 사람이 알 수 없다.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import {
  useMeetingRecorder,
  type RecorderPartStatus,
  type RecorderState,
} from './use-recorder.ts'
import * as blobStore from '../offline/blob-store.ts'
import {
  HEARTBEAT_MS, activeRemote, applyTabMessage, newTabId, openRecordingChannel, parseTabMessage,
  type RemoteRecording, type RecordingTabMessage,
} from './recording-tabs.ts'
import { uploadOnePart } from '../offline/sync-parts.ts'
import { resolvePartDestination } from './part-destination.ts'
import { isLocalNoteId } from '../offline/local-meeting.ts'
import { writeRecordingLease, clearRecordingLease } from '../offline/recording-lease.ts'

/** 지금 녹음이 붙어 있는 회의 — 화면이 바뀌어도 이건 안 바뀐다 */
export interface RecordingTarget {
  /** 원본 회의노트 id. 구간은 항상 여기로 올라간다(원본은 회의노트 하나) */
  noteId: string
  title: string
  /** "회의로 돌아가기"가 갈 곳 — 노트 상세든 CRM 미팅이든 시작한 쪽 */
  href: string
}

interface RecordingContextValue {
  target: RecordingTarget | null
  state: RecorderState
  elapsedSec: number
  /**
   * 마이크 세기 구독 — **값이 아니라 통로다.**
   *
   * 세기를 값으로 실으면 이 컨텍스트를 쓰는 화면 전부가 초당 60번 다시 그려진다
   * (실측 v0.7.685: CRM 미팅 상세 · 녹음 상주 바 · 녹음 패널). 미터는 DOM 에
   * 직접 쓰면 되므로 구독만 내보낸다.
   */
  subscribeLevel: (fn: (level: number) => void) => () => void
  /** 소리가 지속해서 안 잡히나 — 전환이 있을 때만 바뀐다 */
  micQuiet: boolean
  parts: RecorderPartStatus[]
  error: string | null
  supported: boolean
  /** 이 브라우저가 멈췄다 이어하기를 할 수 있나 — 못 하면 단추를 안 그린다 */
  canPause: boolean
  /** 구간이 하나 올라갈 때마다 증가 — 화면이 이걸 보고 진행률을 다시 조회한다 */
  uploadTick: number
  /** 다른 탭에서 돌고 있는 녹음(`recording-tabs.ts`). 있으면 이 탭에서는 시작하지 않는다 */
  remote: RemoteRecording | null
  start: (target: RecordingTarget) => Promise<void>
  /** 회의 중 잠깐 쉰다 — 세션은 그대로 살아 있다 */
  pause: () => void
  /** 멈춘 자리에서 이어서 받아적는다 */
  resume: () => void
  stop: () => Promise<void>
  clearError: () => void
}

const RecordingContext = createContext<RecordingContextValue | null>(null)

/** 셸 밖(테스트·스토리)에서 부품만 그릴 때를 위한 조용한 기본값 — 던지지 않는다 */
const IDLE: RecordingContextValue = {
  target: null, state: 'idle', elapsedSec: 0, parts: [], error: null,
  subscribeLevel: () => () => {}, micQuiet: false,
  supported: false, canPause: false, uploadTick: 0, remote: null,
  start: async () => {}, pause: () => {}, resume: () => {},
  stop: async () => {}, clearError: () => {},
}

export function useRecordingSession(): RecordingContextValue {
  return useContext(RecordingContext) ?? IDLE
}

/** 이 회의가 지금 녹음 중인가 */
export function useIsRecording(noteId: string): boolean {
  const s = useRecordingSession()
  // 멈춰 있어도 녹음 중이다 — 아니라고 하면 화면이 「시작」을 다시 내밀고 세션이 둘로 쪼개진다
  return s.target?.noteId === noteId
    && (s.state === 'recording' || s.state === 'paused' || s.state === 'stopping')
}

/** 녹음을 잡고 있는 다른 곳. `elsewhere` 면 다른 탭이다 — 같은 회의라도 다른 탭이면 여기서 못 시작한다 */
export type BusyTarget = RecordingTarget & { elsewhere?: true }

/** 다른 회의(또는 다른 탭)가 녹음을 잡고 있으면 그것을 돌려준다 — 화면이 "지금은 안 됩니다"를 말할 수 있게 */
export function useBusyWithOther(noteId: string): BusyTarget | null {
  const s = useRecordingSession()
  if (s.remote) return { noteId: s.remote.noteId, title: s.remote.title, href: s.remote.href, elsewhere: true }
  if (!s.target || s.target.noteId === noteId) return null
  if (s.state === 'idle' || s.state === 'error') return null
  return s.target
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  /**
   * 대상은 ref 로도 들고 있는다. `onPart` 가 상태를 참조하면 녹음 도중 콜백 신원이 바뀌는데,
   * 이미 돌고 있는 `MediaRecorder.onstop` 클로저는 **예전 콜백을 붙들고 있어** 업로드가 옛 노트로 간다.
   */
  const targetRef = useRef<RecordingTarget | null>(null)
  const [target, setTarget] = useState<RecordingTarget | null>(null)
  const [uploadTick, setUploadTick] = useState(0)

  /**
   * 구간 하나를 남긴다 — **기기에 먼저 쓰고 나서 올린다.**
   *
   * 예전에는 곧장 올렸고, 실패하면 `use-recorder` 가 상태만 `'failed'` 로 바꾸고
   * **blob 을 버렸다.** 회의실 와이파이가 흔들리면 그 10분이 영원히 사라졌다.
   * 사용자 지시(2026-08-27): *"녹음 하는것도 로컬에서 우선 저장을 하는 방식으로"*.
   *
   * 순서가 곧 계약이다 — `로컬에 쓰기 → 올리기 → 성공한 것만 지우기`.
   * 실패해도 **원본은 기기에 남고**, 연결되면 `syncPendingParts` 가 다시 올린다.
   */
  const uploadPart = useCallback(async (blob: Blob, partIdx: number, durationSec: number) => {
    const t = targetRef.current
    if (!t) throw new Error('녹음 대상이 없어요')
    /*
      지역 id 는 서버에 없는 주소다. 건넨 짝이 있으면 서버 id 로, 없으면 기기에만 둔다.
      녹음 중에 회의가 건너간 뒤 지역 주소로 올려 404 를 치던 구멍(2026-10-26 실측)
    */
    const dest = resolvePartDestination(t.noteId)

    // ① 기기에 먼저. 여기서 실패해도 업로드는 해 본다 — 둘 다 못 하는 것보다 낫다
    let savedLocally = false
    if (blobStore.isSupported()) {
      try {
        await blobStore.put({ noteId: dest.noteId, partIdx, durationSec, blob })
        savedLocally = true
      } catch {
        // 로컬 보관 없이 도는 중이라는 뜻 — 화면이 "이 기기에 저장 중"이라고 말하면 안 된다
        console.error('[recording] 로컬 보관 실패 — 업로드만 시도합니다')
      }
    }

    /*
      올릴 곳이 아직 없다. 시도로 세지 않고(markTried 안 함) 기기에 둔다.
      정상 반환하면 구간이 「올라감」으로 보이므로, 기기에 둔 사실을 말하며 던진다
    */
    if (!dest.upload) {
      throw new Error(savedLocally
        ? '이 기기에 저장해 뒀어요. 연결되면 자동으로 올립니다.'
        : '녹음을 이 기기에 저장하지 못했어요')
    }

    // ② 올린다
    try {
      await uploadOnePart(dest.noteId, partIdx, durationSec, blob)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '녹음을 올리지 못했어요'
      if (savedLocally) await blobStore.markTried(dest.noteId, partIdx, msg).catch(() => {})
      throw new Error(
        savedLocally
          ? `${msg} — 이 기기에 저장해 뒀어요. 연결되면 자동으로 올립니다.`
          : msg,
      )
    }

    // ③ 올라간 것은 기기에서 지운다 — 남기면 회의 음성이 노트북에 쌓인다(결정 5)
    if (savedLocally) await blobStore.remove(dest.noteId, partIdx).catch(() => {})
    setUploadTick((n) => n + 1)
  }, [])

  const rec = useMeetingRecorder({ onPart: uploadPart })

  /*
    ── 다른 탭과 녹음 상태를 나눈다(`recording-tabs.ts`) ──
    새 탭에서 녹음을 하나 더 시작하던 구멍을 막는다. 소리는 나누지 않고 이름·경과·상태만.
  */
  const tabId = useRef<string>('')
  if (!tabId.current) tabId.current = newTabId()
  const channelRef = useRef<BroadcastChannel | null>(null)
  const [remoteTable, setRemoteTable] = useState<Map<string, RemoteRecording>>(() => new Map())
  const [now, setNow] = useState(() => Date.now())
  const localBusy = rec.state === 'recording' || rec.state === 'paused' || rec.state === 'stopping'
  /** 채널 콜백이 늘 최신 값을 보게 — 상태를 의존에 넣으면 소식마다 채널을 다시 연다 */
  const liveRef = useRef<(() => RecordingTabMessage | null)>(() => null)
  liveRef.current = () => {
    const t = targetRef.current
    if (!t || !localBusy) return null
    return {
      type: 'live', tabId: tabId.current, noteId: t.noteId, title: t.title, href: t.href,
      state: rec.state as RemoteRecording['state'], elapsedSec: rec.elapsedSec, at: Date.now(),
    }
  }

  useEffect(() => {
    const ch = openRecordingChannel()
    if (!ch) return undefined
    channelRef.current = ch
    ch.onmessage = (e: MessageEvent) => {
      const msg = parseTabMessage(e.data)
      if (!msg || msg.tabId === tabId.current) return
      if (msg.type === 'ask') {
        const live = liveRef.current()
        if (live) ch.postMessage(live)
        return
      }
      setRemoteTable((prev) => applyTabMessage(prev, msg, tabId.current))
      setNow(Date.now())
    }
    ch.postMessage({ type: 'ask', tabId: tabId.current })
    const onHide = () => { if (liveRef.current()) ch.postMessage({ type: 'gone', tabId: tabId.current }) }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      onHide()
      ch.close()
      channelRef.current = null
    }
  }, [])

  /* 녹음하는 동안 「아직 녹음 중」을 알리고, 끝나면 「끝났다」를 알린다 */
  useEffect(() => {
    const ch = channelRef.current
    if (!ch) return undefined
    if (!localBusy) {
      ch.postMessage({ type: 'gone', tabId: tabId.current })
      return undefined
    }
    const send = () => { const live = liveRef.current(); if (live) ch.postMessage(live) }
    send()
    const t = setInterval(send, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [localBusy, rec.state, target])

  /*
    지역 회의를 녹음하는 동안 녹음 임대를 건다(`recording-lease.ts`).
    다른 탭의 건네기가 소식을 못 받았어도 이 회의는 녹음 중인 줄 안다. 끝나면 놓는다
  */
  const leaseNoteId = localBusy && target && isLocalNoteId(target.noteId) ? target.noteId : null
  useEffect(() => {
    if (!leaseNoteId) return undefined
    writeRecordingLease(leaseNoteId)
    const t = setInterval(() => writeRecordingLease(leaseNoteId), HEARTBEAT_MS)
    return () => {
      clearInterval(t)
      clearRecordingLease(leaseNoteId)
    }
  }, [leaseNoteId])

  /* 소식이 끊긴 탭을 걸러 내려면 시계가 흘러야 한다 — 다른 탭 소식이 있을 때만 돈다 */
  useEffect(() => {
    if (remoteTable.size === 0) return undefined
    const t = setInterval(() => setNow(Date.now()), HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [remoteTable.size])

  const remote = localBusy ? null : activeRemote(remoteTable, now)

  const start = useCallback(async (next: RecordingTarget) => {
    // 다른 탭이 녹음 중이면 여기서는 시작하지 않는다 — 화면이 먼저 막고 이유를 말한다
    if (remote) return
    // 동시 녹음 금지 — 돌고 있으면 조용히 무시하지 않고 그대로 둔다(화면이 먼저 막는다)
    if (targetRef.current && (rec.state === 'recording' || rec.state === 'paused' || rec.state === 'stopping')) return
    targetRef.current = next
    setTarget(next)
    await rec.start()
  }, [rec, remote])

  const stop = useCallback(async () => {
    await rec.stop()
  }, [rec])

  /** 종료가 끝나면 대상을 놓는다 — 남겨 두면 "녹음 중"으로 보이는 잔상이 생긴다 */
  useEffect(() => {
    if (rec.state === 'idle' && target && rec.parts.every((p) => p.state !== 'uploading')) {
      targetRef.current = null
      setTarget(null)
    }
  }, [rec.state, rec.parts, target])

  /**
   * 창을 닫으려 하면 막아 세운다.
   *
   * 라우트 이동은 이제 안전하지만(제공자가 셸에 있다) **탭 종료는 못 막는다** —
   * 진행 중 구간은 업로드에 몇 초가 걸리는데 브라우저는 기다려 주지 않는다.
   * 그래서 유일하게 정직한 수단인 확인창을 띄운다. 조용히 잃는 것보다 낫다.
   */
  useEffect(() => {
    const busy = rec.state === 'recording' || rec.state === 'paused' || rec.state === 'stopping'
      || rec.parts.some((p) => p.state === 'uploading')
    if (!busy) return undefined
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [rec.state, rec.parts])

  const value = useMemo<RecordingContextValue>(() => ({
    target,
    state: rec.state,
    elapsedSec: rec.elapsedSec,
    subscribeLevel: rec.subscribeLevel,
    micQuiet: rec.micQuiet,
    parts: rec.parts,
    error: rec.error,
    supported: rec.supported,
    canPause: rec.canPause,
    uploadTick,
    remote,
    start,
    pause: rec.pause,
    resume: rec.resume,
    stop,
    clearError: () => {},
  }), [
    target, rec.state, rec.elapsedSec, rec.subscribeLevel, rec.micQuiet, rec.parts,
    rec.error, rec.supported, rec.canPause, rec.pause, rec.resume, uploadTick, remote, start, stop,
  ])

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>
}
