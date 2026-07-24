// 목록 심층분석 v2 — "관전자" 클라이언트 훅(.ralph/decisions/DECISION-20260715-ui-realtime-client.md).
// 실행주체는 서버(lib/ai-chat/analyze-runner.ts drainSession)+크론(app/api/cron/analyze-drain)이다.
// 이 훅은 (1) SSE POST로 실시간 delta·progress를 받고 (2) 항목별 상태(status/resultText)·세션 확장필드
// (phase/control/synth)는 SSE 페이로드에 없으므로 폴링(getAnalysisSession·getSessionExtras)으로
// 진실 동기화한다. 폴링은 SSE 연결 여부와 무관하게 항상 돈다 — SSE가 끊겨도(이탈·네트워크) 화면은
// 계속 서버 파생값을 반영한다(진행률 클라 계산·하드코딩 금지). 서버 작업 자체는 탭을 닫아도
// 크론이 이어받아 계속 진행된다.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSseParser } from '@/lib/ai-chat/sse'
import { getAnalysisSession } from './session-persist-actions'
import {
  setSessionControl,
  updateAnalysisItem,
  updateSessionSynth,
  getSessionExtras,
  type AnalysisItemStatus,
  type AnalysisSessionControl,
  type SessionCoverage,
} from './session-item-actions'

const POLL_MS = 2500

export interface StreamItemState {
  idx: number
  text: string
  status: AnalysisItemStatus
  resultText: string | null
}

export interface StreamProgress {
  phase: string
  total: number
  pending: number
  running: number
  done: number
  error: number
  synthStatus: string
}

export type StreamMode = 'connecting' | 'live' | 'polling' | 'finished'

export interface InitialItem {
  idx: number
  text: string
  status: AnalysisItemStatus
  resultText: string | null
}

function settled(progress: StreamProgress | null): boolean {
  if (!progress) return false
  if (progress.total === 0) return true
  return (
    progress.pending === 0 &&
    progress.running === 0 &&
    (progress.synthStatus === 'done' || progress.synthStatus === 'error')
  )
}

export function useAnalysisStream(sessionId: string, initialItems: InitialItem[]) {
  const [items, setItems] = useState<Record<number, StreamItemState>>(() => {
    const map: Record<number, StreamItemState> = {}
    initialItems.forEach((it) => {
      map[it.idx] = { idx: it.idx, text: it.text, status: it.status, resultText: it.resultText }
    })
    return map
  })
  const [deltas, setDeltas] = useState<Record<number, string>>({})
  const [progress, setProgress] = useState<StreamProgress | null>(null)
  const [control, setControlState] = useState<AnalysisSessionControl>('running')
  const [synthStatus, setSynthStatus] = useState<string>('pending')
  const [synthText, setSynthText] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<SessionCoverage | null>(null)
  const [mode, setMode] = useState<StreamMode>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)

  const controlRef = useRef<AnalysisSessionControl>('running')
  const sseTokenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const applyItems = useCallback((rows: InitialItem[]) => {
    setItems((prev) => {
      const next = { ...prev }
      rows.forEach((r) => {
        next[r.idx] = { idx: r.idx, text: r.text, status: r.status, resultText: r.resultText }
      })
      return next
    })
  }, [])

  const pollTick = useCallback(async (): Promise<void> => {
    const [sessionRes, extras] = await Promise.all([getAnalysisSession(sessionId), getSessionExtras(sessionId)])
    if (sessionRes.ok) applyItems(sessionRes.session.items)
    if (extras) {
      setControlState(extras.control)
      controlRef.current = extras.control
      setSynthStatus(extras.synthStatus)
      if (extras.synthText) setSynthText(extras.synthText)
      if (extras.coverage) setCoverage(extras.coverage)
    }
  }, [sessionId, applyItems])

  const handleEvent = useCallback((ev: unknown): { done: boolean; drained: boolean } => {
    if (!ev || typeof ev !== 'object') return { done: false, drained: false }
    const e = ev as {
      progress?: StreamProgress
      itemIdx?: number
      delta?: string
      done?: boolean
      drained?: boolean
      error?: string
    }
    if (e.progress) {
      setProgress(e.progress)
      setSynthStatus(e.progress.synthStatus)
    }
    if (typeof e.itemIdx === 'number' && typeof e.delta === 'string') {
      const idx = e.itemIdx
      setDeltas((prev) => ({ ...prev, [idx]: (prev[idx] ?? '') + e.delta }))
    }
    if (e.error) setStreamError(e.error)
    return { done: !!e.done, drained: !!e.drained }
  }, [])

  /** SSE POST 1회 — 스트림이 끝날 때(서버 done 이벤트 or reader 종료)까지 대기 후 drained 여부 반환. */
  const runSseOnce = useCallback(async (): Promise<{ drained: boolean }> => {
    const controller = new AbortController()
    abortRef.current = controller
    setMode('connecting')
    const res = await fetch('/api/admin/ai-chat/analyze/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) throw new Error('스트림 연결 실패')
    setMode('live')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    let drained = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        const r = handleEvent(ev)
        if (r.done) drained = r.drained
      }
    }
    for (const ev of parser.flush()) {
      const r = handleEvent(ev)
      if (r.done) drained = r.drained
    }
    return { drained }
  }, [sessionId, handleEvent])

  /** control==='running'인 동안 SSE POST를 반복(§ 재-POST는 멱등 claim). 이미 도는 루프는 토큰으로 무시. */
  const startSseLoop = useCallback((): void => {
    const token = ++sseTokenRef.current
    ;(async () => {
      while (sseTokenRef.current === token && controlRef.current === 'running') {
        try {
          const { drained } = await runSseOnce()
          await pollTick().catch(() => {})
          if (drained) break
        } catch {
          setMode('polling') // SSE 실패 — 계속 도는 폴링 단독으로 진실 동기화(§ SSE 끊김 폴백)
          break
        }
      }
    })()
  }, [runSseOnce, pollTick])

  // 폴링 — SSE 연결 여부와 무관하게 항상 돈다(서버 파생값 SSOT). 완료 판정되면 스스로 멈춘다.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setInterval> | null = null
    async function tick(): Promise<void> {
      if (stopped) return
      await pollTick().catch(() => {})
    }
    tick()
    timer = setInterval(tick, POLL_MS)
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
    }
  }, [pollTick])

  useEffect(() => {
    if (settled(progress)) setMode('finished')
  }, [progress])

  // 최초 진입 시 SSE 루프 착수(§ 관전자 — 클라는 진행을 그리기만, 실행은 서버).
  // 단, 이미 전 항목이 done인 세션(이전 분석 재열람)은 SSE를 열지 않는다 — 서버는 done을 claim하지
  // 않아 즉시 no-op이지만, 그 사이 'connecting/live' 스피너가 떠 사용자에게 "재분석 중"으로 오인된다.
  // 미완료 항목이 하나라도 있으면(신규 분석·이어하기) 정상적으로 SSE를 연다. synth 확정은 폴링이 반영.
  useEffect(() => {
    const allDone = initialItems.length > 0 && initialItems.every((it) => it.status === 'done')
    if (!allDone) startSseLoop()
    else setMode('finished') // 재열람·대화종합 진입: SSE 없이도 '연결 중' 잔상 없이 완료 표시(폴링이 진실 반영)
    return () => {
      sseTokenRef.current += 1 // 진행 중인 루프 무효화
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const pause = useCallback(async (): Promise<void> => {
    await setSessionControl(sessionId, 'paused')
    controlRef.current = 'paused'
    setControlState('paused')
  }, [sessionId])

  const cancel = useCallback(async (): Promise<void> => {
    await setSessionControl(sessionId, 'cancelled')
    controlRef.current = 'cancelled'
    setControlState('cancelled')
    abortRef.current?.abort() // 클라 자신의 SSE fetch 즉시 종료(서버 in-flight 중단은 control 폴링이 처리)
    await pollTick().catch(() => {})
  }, [sessionId, pollTick])

  const resume = useCallback(async (): Promise<void> => {
    controlRef.current = 'running'
    setControlState('running')
    await setSessionControl(sessionId, 'running')
    startSseLoop()
  }, [sessionId, startSseLoop])

  // 종합 무효화 — 항목이 바뀌면(재시도) 기존 취합본은 낡았으므로 pending으로 되돌려 재취합을 유도한다.
  // 이 처리가 없으면 synth_status='done'인 세션은 drainSession이 조기 반환해 재취합이 영원히 안 됨(사고).
  const invalidateSynth = useCallback(async (): Promise<void> => {
    setSynthStatus('pending')
    setSynthText(null)
    await updateSessionSynth(sessionId, { synthStatus: 'pending' }).catch(() => {})
  }, [sessionId])

  const retryItem = useCallback(
    async (idx: number): Promise<void> => {
      await updateAnalysisItem({ sessionId, idx, status: 'pending' })
      setItems((prev) => ({ ...prev, [idx]: { ...prev[idx], status: 'pending', resultText: null } }))
      setDeltas((prev) => {
        const { [idx]: _drop, ...rest } = prev
        return rest
      })
      await invalidateSynth() // 재시도 완료 후 자동 재취합
      if (controlRef.current === 'running') startSseLoop()
      else await resume()
    },
    [sessionId, startSseLoop, resume, invalidateSynth],
  )

  const retryAllFailed = useCallback(async (): Promise<void> => {
    const failed = Object.values(items).filter((i) => i.status === 'error')
    if (failed.length === 0) return
    await Promise.all(failed.map((i) => updateAnalysisItem({ sessionId, idx: i.idx, status: 'pending' })))
    setItems((prev) => {
      const next = { ...prev }
      failed.forEach((f) => {
        next[f.idx] = { ...next[f.idx], status: 'pending', resultText: null }
      })
      return next
    })
    await invalidateSynth() // 재시도 완료 후 자동 재취합
    if (controlRef.current === 'running') startSseLoop()
    else await resume()
  }, [items, sessionId, startSseLoop, resume, invalidateSynth])

  // 수동 "다시 취합" — 항목은 그대로 두고 종합만 다시 생성(사용자가 원할 때 언제든).
  const resynthesize = useCallback(async (): Promise<void> => {
    await invalidateSynth()
    if (controlRef.current === 'running') startSseLoop()
    else await resume()
  }, [invalidateSynth, startSseLoop, resume])

  return {
    items,
    deltas,
    progress,
    control,
    synthStatus,
    synthText,
    coverage,
    mode,
    streamError,
    pause,
    cancel,
    resume,
    retryItem,
    retryAllFailed,
    resynthesize,
  }
}
