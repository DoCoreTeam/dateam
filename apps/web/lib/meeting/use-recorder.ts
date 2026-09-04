'use client'

/**
 * 회의 녹음 훅 — 10분마다 레코더를 새로 연다 (통합 기획 §5-1)
 *
 * **왜 `timeslice` 가 아니라 레코더 회전인가.**
 * `MediaRecorder` 의 `timeslice` 조각은 **첫 조각에만 헤더가 있다.**
 * 2번째부터는 단독으로 디코딩이 안 되므로 따로 전사할 수 없다.
 * 10분마다 stop → start 하면 구간마다 **완결된 오디오 파일**이 나온다.
 *
 * 이 구조가 그냥 얻어 주는 것 넷:
 *   ① 회의 중에 앞 구간이 이미 업로드·전사까지 끝난다 → 종료 후 기다림이 거의 없다
 *   ② 브라우저가 죽어도 올라간 구간은 남는다(최대 유실 = 마지막 10분 미만)
 *   ③ "3/6 구간"을 정직하게 말할 수 있다
 *   ④ 구간이 2~3MB 라 우리 API 를 그냥 통과한다(서명 URL 이 필요 없다)
 *
 * 레벨 미터는 장식이 아니다 — **마이크가 실제로 소리를 받고 있는지 보여 주는 유일한 수단**이다.
 * 무음으로 60분을 녹음하고 끝에서야 아는 것이 이 기능의 최악의 실패다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  nextMicSilence,
  IDLE_MIC_SILENCE,
  type MicSilenceState,
} from './mic-silence.ts'
import { PART_MS } from './recording-core.ts'
// ⚠️ recording.ts 를 가리키면 안 된다 — 그 파일은 드라이브 저장을 함께 갖고 있어,
// 동적 import 라도 번들러가 googleapis 를 클라이언트로 끌고 들어와 앱 전체가 500 이 된다(v0.7.578 실측).

/** 우선순위대로 시도한다. Safari 는 webm 을 못 만들어 mp4 로 떨어진다. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const

/** 음성 모노 기준. 60분이면 약 14MB, 10분 구간이면 2~3MB. */
const AUDIO_BITS_PER_SECOND = 32_000

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'error'

export interface RecorderPartStatus {
  idx: number
  /** uploading → uploaded → failed. 전사 상태는 서버가 알려 준다 */
  state: 'uploading' | 'uploaded' | 'failed'
  error?: string
}

export interface UseRecorderOptions {
  /** 구간 하나가 닫힐 때마다 부른다. 실패하면 그 구간만 failed 로 표시된다 */
  onPart: (blob: Blob, partIdx: number, durationSec: number) => Promise<void>
}

export interface UseRecorder {
  state: RecorderState
  /** 녹음 경과(초) */
  elapsedSec: number
  /**
   * 마이크 입력 세기(0~1) 구독 — **리액트 상태가 아니다.**
   *
   * 세기는 `requestAnimationFrame` 이 초당 60번 갱신한다. 이걸 상태로 들면
   * 컨텍스트를 타고 소비자 전부가 초당 60번 다시 그려진다(실측: CRM 미팅 상세 전체).
   * 미터는 그 값을 **DOM 에 직접** 쓰면 되므로 구독으로만 흘린다.
   *
   * 돌려주는 함수를 부르면 구독이 끊긴다. 구독 즉시 마지막 값을 한 번 준다.
   */
  subscribeLevel: (fn: (level: number) => void) => () => void
  /**
   * 소리가 **지속해서** 안 잡히나 — 순간값이 아니다(`mic-silence.ts`).
   * 전환이 있을 때만 바뀌므로 이 값이 리렌더를 만들어도 초당 몇 번이 아니다.
   */
  micQuiet: boolean
  parts: RecorderPartStatus[]
  error: string | null
  /** 브라우저가 녹음을 지원하나 — 지원 안 하면 버튼을 그리지 않는다 */
  supported: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
}

/** 이 브라우저에서 쓸 수 있는 형식 하나. 없으면 null — 지어내지 않는다 */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch { /* 구형 브라우저는 이 함수 자체가 없다 */ }
  }
  return null
}

/**
 * 마이크를 못 쓰는 이유를 사람 말로.
 *
 * `/lead-intake` 가 쓰는 진단과 같은 성격이다 — 권한 거부와 비보안 컨텍스트는
 * 증상이 같은데 원인이 달라서, 구분해 말하지 않으면 사용자가 영원히 못 고친다.
 */
export function describeMicFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '마이크 사용이 차단돼 있어요. 주소창의 자물쇠에서 마이크를 허용한 뒤 다시 눌러 주세요. 지금은 회의 내용을 붙여넣을 수도 있습니다.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인해 주세요.'
  }
  if (name === 'NotReadableError') {
    return '마이크를 다른 프로그램이 쓰고 있어요. 화상회의 앱을 닫고 다시 시도해 주세요.'
  }
  return '마이크를 열지 못했어요. 회의 내용을 붙여넣는 방법도 있습니다.'
}

export function useMeetingRecorder({ onPart }: UseRecorderOptions): UseRecorder {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [micQuiet, setMicQuiet] = useState(false)
  const [parts, setParts] = useState<RecorderPartStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const partIdxRef = useRef(0)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 미터 구독자 — 리액트를 거치지 않고 값을 받는다 */
  const levelSubsRef = useRef<Set<(level: number) => void>>(new Set())
  const lastLevelRef = useRef(0)
  /** 무음 판정 상태 — 전환이 있을 때만 리액트로 올린다 */
  const silenceRef = useRef<MicSilenceState>(IDLE_MIC_SILENCE)
  /** 사용자가 종료를 눌렀나 — 회전과 종료를 구분해야 마지막 구간 뒤에 다시 시작하지 않는다 */
  const stoppingRef = useRef(false)

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices && pickMimeType() !== null)
  }, [])

  /**
   * 미터가 값을 받아 가는 유일한 통로.
   * 참조가 바뀌지 않아야 컨텍스트 memo 가 매 프레임 새로 만들어지지 않는다.
   */
  const subscribeLevel = useCallback((fn: (level: number) => void) => {
    const subs = levelSubsRef.current
    subs.add(fn)
    fn(lastLevelRef.current) // 구독 즉시 현재 값 — 첫 프레임까지 0 으로 비어 보이지 않게
    return () => { subs.delete(fn) }
  }, [])

  const cleanup = useCallback(() => {
    if (rotateTimerRef.current) { clearTimeout(rotateTimerRef.current); rotateTimerRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    recorderRef.current = null
    // 미터를 0 으로 되돌리고 무음 판정도 초기화한다 —
    // 안 하면 다음 녹음이 «이미 조용한» 상태로 시작해 경고부터 뜬다
    lastLevelRef.current = 0
    levelSubsRef.current.forEach((fn) => { try { fn(0) } catch { /* 구독자 하나가 죽어도 정리는 계속된다 */ } })
    silenceRef.current = IDLE_MIC_SILENCE
    setMicQuiet(false)
  }, [])

  /**
   * 언마운트 — **트랙부터 끊지 않는다.**
   *
   * 예전에는 여기서 바로 `getTracks().stop()` 을 했다. 그러면 진행 중 구간의
   * `ondataavailable` 가 정상 경로로 발화하지 않아 **그 구간이 통째로 사라졌다**(최대 10분).
   * 게다가 `stoppingRef` 가 false 라 `onstop` 이 죽은 스트림으로 다음 구간을 열려고 했다.
   *
   * 지금은 제공자가 셸에 있어 라우트 이동으로는 여기 오지 않는다(`lib/meeting/recording-context.tsx`).
   * 그래도 마지막 방어선은 남긴다 — 먼저 레코더를 닫아 조각을 흘려보내고, 정리는 `onstop` 이 한다.
   */
  useEffect(() => () => {
    const rec = recorderRef.current
    if (rec && rec.state === 'recording') {
      stoppingRef.current = true
      try { rec.stop() } catch { /* 이미 죽은 레코더 */ }
      return
    }
    cleanup()
  }, [cleanup])

  /** 구간 하나를 올린다. 실패해도 녹음은 계속된다 — 한 구간 때문에 회의를 멈추지 않는다 */
  const uploadPart = useCallback(async (blob: Blob, idx: number, durationSec: number) => {
    const pending: RecorderPartStatus = { idx, state: 'uploading' }
    setParts((prev) => [...prev.filter((p) => p.idx !== idx), pending].sort((a, b) => a.idx - b.idx))
    try {
      await onPart(blob, idx, durationSec)
      setParts((prev) => prev.map((p) => (p.idx === idx ? { ...p, state: 'uploaded' } : p)))
    } catch (e) {
      setParts((prev) => prev.map((p) => (
        p.idx === idx
          ? { ...p, state: 'failed', error: e instanceof Error ? e.message : '올리지 못했어요' }
          : p
      )))
    }
  }, [onPart])

  /** 레코더 하나를 만들어 돌린다. 멈추면 그 조각을 올리고, 종료가 아니면 다음 구간을 연다 */
  const spawnRecorder = useCallback((mime: string, startedAt: number) => {
    const stream = streamRef.current
    if (!stream) return
    const idx = partIdxRef.current
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
    const chunks: Blob[] = []

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime })
      const durationSec = Math.round((Date.now() - startedAt) / 1000)
      if (blob.size > 0) void uploadPart(blob, idx, durationSec)
      if (!stoppingRef.current) {
        partIdxRef.current = idx + 1
        spawnRecorder(mime, Date.now())
      } else {
        cleanup()
        setState('idle')
      }
    }

    rec.start()
    recorderRef.current = rec
    // 10분이 되면 닫는다 — 이게 구간을 완결된 파일로 만드는 지점이다
    rotateTimerRef.current = setTimeout(() => {
      if (rec.state === 'recording') rec.stop()
    }, PART_MS)
  }, [uploadPart, cleanup])

  const start = useCallback(async () => {
    setError(null)
    setState('requesting')
    stoppingRef.current = false
    partIdxRef.current = 0
    setParts([])
    setElapsedSec(0)

    const mime = pickMimeType()
    if (!mime) {
      setSupported(false)
      setError('이 브라우저는 녹음을 지원하지 않아요. 회의 내용을 붙여넣어 주세요.')
      setState('error')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch (e) {
      setError(describeMicFailure(e))
      setState('error')
      return
    }
    streamRef.current = stream

    // 시작 시각은 오디오 그래프보다 **먼저** 잡는다 — 무음 판정의 준비 시간 기준이다
    const startedAt = Date.now()
    silenceRef.current = IDLE_MIC_SILENCE
    setMicQuiet(false)

    // 레벨 미터 — 마이크가 살아 있는지 눈으로 보이게 한다
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const loop = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4)

          // 미터는 리액트를 거치지 않는다 — 여기서 setState 를 하면 초당 60번 리렌더된다
          lastLevelRef.current = lvl
          levelSubsRef.current.forEach((fn) => {
            try { fn(lvl) } catch { /* 구독자 하나가 죽어도 녹음은 계속된다 */ }
          })

          // 무음은 «지속»으로만 판정한다 — 전환이 있을 때만 리액트로 올린다
          const nextSilence = nextMicSilence(silenceRef.current, {
            level: lvl,
            nowMs: Date.now(),
            startedAtMs: startedAt,
          })
          if (nextSilence.quiet !== silenceRef.current.quiet) setMicQuiet(nextSilence.quiet)
          silenceRef.current = nextSilence

          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      }
    } catch { /* 레벨 미터가 없어도 녹음은 된다 */ }

    tickRef.current = setInterval(() => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)), 1000)
    spawnRecorder(mime, Date.now())
    setState('recording')
  }, [spawnRecorder])

  const stop = useCallback(async () => {
    stoppingRef.current = true
    setState('stopping')
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else { cleanup(); setState('idle') }
  }, [cleanup])

  return { state, elapsedSec, subscribeLevel, micQuiet, parts, error, supported, start, stop }
}
