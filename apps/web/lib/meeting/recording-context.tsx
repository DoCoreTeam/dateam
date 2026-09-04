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
import { uploadOnePart } from '../offline/sync-parts.ts'

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
  /** 구간이 하나 올라갈 때마다 증가 — 화면이 이걸 보고 진행률을 다시 조회한다 */
  uploadTick: number
  start: (target: RecordingTarget) => Promise<void>
  stop: () => Promise<void>
  clearError: () => void
}

const RecordingContext = createContext<RecordingContextValue | null>(null)

/** 셸 밖(테스트·스토리)에서 부품만 그릴 때를 위한 조용한 기본값 — 던지지 않는다 */
const IDLE: RecordingContextValue = {
  target: null, state: 'idle', elapsedSec: 0, parts: [], error: null,
  subscribeLevel: () => () => {}, micQuiet: false,
  supported: false, uploadTick: 0,
  start: async () => {}, stop: async () => {}, clearError: () => {},
}

export function useRecordingSession(): RecordingContextValue {
  return useContext(RecordingContext) ?? IDLE
}

/** 이 회의가 지금 녹음 중인가 */
export function useIsRecording(noteId: string): boolean {
  const s = useRecordingSession()
  return s.target?.noteId === noteId && (s.state === 'recording' || s.state === 'stopping')
}

/** 다른 회의가 녹음을 잡고 있으면 그 회의를 돌려준다 — 화면이 "지금은 안 됩니다"를 말할 수 있게 */
export function useBusyWithOther(noteId: string): RecordingTarget | null {
  const s = useRecordingSession()
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

    // ① 기기에 먼저. 여기서 실패해도 업로드는 해 본다 — 둘 다 못 하는 것보다 낫다
    let savedLocally = false
    if (blobStore.isSupported()) {
      try {
        await blobStore.put({ noteId: t.noteId, partIdx, durationSec, blob })
        savedLocally = true
      } catch {
        // 로컬 보관 없이 도는 중이라는 뜻 — 화면이 "이 기기에 저장 중"이라고 말하면 안 된다
        console.error('[recording] 로컬 보관 실패 — 업로드만 시도합니다')
      }
    }

    // ② 올린다
    try {
      await uploadOnePart(t.noteId, partIdx, durationSec, blob)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '녹음을 올리지 못했어요'
      if (savedLocally) await blobStore.markTried(t.noteId, partIdx, msg).catch(() => {})
      throw new Error(
        savedLocally
          ? `${msg} — 이 기기에 저장해 뒀어요. 연결되면 자동으로 올립니다.`
          : msg,
      )
    }

    // ③ 올라간 것은 기기에서 지운다 — 남기면 회의 음성이 노트북에 쌓인다(결정 5)
    if (savedLocally) await blobStore.remove(t.noteId, partIdx).catch(() => {})
    setUploadTick((n) => n + 1)
  }, [])

  const rec = useMeetingRecorder({ onPart: uploadPart })

  const start = useCallback(async (next: RecordingTarget) => {
    // 동시 녹음 금지 — 돌고 있으면 조용히 무시하지 않고 그대로 둔다(화면이 먼저 막는다)
    if (targetRef.current && (rec.state === 'recording' || rec.state === 'stopping')) return
    targetRef.current = next
    setTarget(next)
    await rec.start()
  }, [rec])

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
    const busy = rec.state === 'recording' || rec.state === 'stopping'
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
    uploadTick,
    start,
    stop,
    clearError: () => {},
  }), [target, rec.state, rec.elapsedSec, rec.subscribeLevel, rec.micQuiet, rec.parts, rec.error, rec.supported, uploadTick, start, stop])

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>
}
