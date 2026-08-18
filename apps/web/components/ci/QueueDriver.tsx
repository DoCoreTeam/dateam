'use client'

// components/ci/QueueDriver.tsx — 큐 구동기 (설계 §7-0 A)
//
// 크론을 늘리지 않고 큐를 돌리는 주 경로다. 화면이 열려 있는 동안 짧은 요청을 반복해
// 큐를 비운다. 서버는 소량·짧은 예산으로 끊고 남은 수를 돌려주므로, 남아 있으면
// 몰아치고 비었으면 느긋해진다.
//
// 규칙 3개:
//  · 보이지 않으면 때리지 않는다 — 배경 탭이 조용히 쿼터를 태우면 안 된다
//  · 앞 요청이 끝나기 전에 다음 요청을 보내지 않는다 — 느린 잡에 요청을 쌓지 않는다
//  · 실패하면 물러난다 — 서버가 아플 때 몰아치면 더 아프게 만든다
//
// 그리고 **조용히 멈추지 않는다.** 진행 중이거나 멈춰 있으면 화면에 그대로 보여준다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import QueueProgressPanel from './QueueProgressPanel'
import styles from './queue-driver.module.css'
import {
  nextDriverDelayMs, DRIVER_MAX_ERRORS,
} from '@/lib/ci/jobs/drain-policy'
import type { ApiResponse } from '@/lib/ci/contracts'

interface DrainResponse {
  skipped: 'too_soon' | null
  remaining: number | null
  claimed?: number
  succeeded?: number
  failed?: number
  dead?: number
  recovered?: number
}

type Phase = 'idle' | 'working' | 'stalled'

interface QueueDriverProps {
  workspaceId: string
  /**
   * 서버가 이미 아는 남은 건수.
   *
   * 왜 필요한가: 예전에는 첫 tick이 끝나야 상태를 알았다. 그런데 이 부품은
   * **보이지 않으면 때리지 않는다**(아래 규칙). 그래서 다른 탭을 보다가 돌아오면
   * 그 순간까지 화면이 "아무 일도 없음"으로 보였다 — 실제로는 1,017건이 밀려 있는데도.
   * 서버가 페이지를 그릴 때 이미 아는 값이므로 그대로 받아 시작한다.
   */
  initialRemaining?: number
}

/**
 * 마지막으로 "할 일 없음"을 확인한 시각. 탭이 살아 있는 동안 유지된다.
 *
 * 왜 필요한가: 이 부품은 CI 셸에 붙어 있어 **화면을 옮길 때마다 다시 마운트**된다.
 *   그때마다 첫 틱이 즉시 나가는데, 큐가 비어 있어도 그 요청 하나가
 *   **인증 서버 왕복 1회 + DB 왕복 5~7회**다(좀비 회수·스냅샷·스윕 점검 때문에).
 *   화면 다섯 개를 넘기면 아무 일도 없는데 왕복 30회를 쓴다.
 *   (근거: docs/2026-08-16-performance-audit/PLAN.md §2-2)
 *
 * 모듈 변수라 새로고침하면 사라진다 — 막힌 큐를 영원히 못 보는 일은 없다.
 */
let lastIdleAt = 0

/** 비어 있음을 확인한 뒤 이 시간 안의 재마운트는 묻지 않는다. */
export const IDLE_REMOUNT_GRACE_MS = 30_000

/**
 * "지금 할 일이 생겼다"를 알린다 — 링크를 넣은 직후처럼.
 *
 * 이게 없으면 위의 유예 때문에 방금 넣은 링크가 최대 30초 동안 처리되지 않는 것처럼
 * 보인다. 아낀 왕복보다 **넣자마자 도는 것**이 중요하다.
 */
export function wakeQueueDriver(): void {
  lastIdleAt = 0
}

export default function QueueDriver({ workspaceId, initialRemaining = 0 }: QueueDriverProps) {
  // 서버가 아는 값으로 시작한다 — 첫 tick을 기다리는 동안 "아무 일도 없음"으로 보이지 않게
  const [phase, setPhase] = useState<Phase>(initialRemaining > 0 ? 'working' : 'idle')
  const [remaining, setRemaining] = useState(initialRemaining)
  const [panelOpen, setPanelOpen] = useState(false)
  // 닫기 함수를 고정한다 — 이 부품은 몇 초마다 다시 그려지는데,
  // 매번 새 함수를 넘기면 패널의 포커스 트랩 effect가 그때마다 재등록된다.
  const closePanel = useCallback(() => setPanelOpen(false), [])

  // 렌더와 무관한 구동 상태는 ref로 둔다 — 상태로 두면 매 틱마다 effect가 재생성된다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const errors = useRef(0)
  const stopped = useRef(false)
  /** 직전 응답이 서버 문턱에 걸렸는가. 걸렸으면 남은 잡 수를 모르는 상태다 */
  const throttled = useRef(false)
  /**
   * 남은 잡 수의 **최신값**. 화면용 state와 별도로 ref에도 둔다.
   *
   * 왜 필요한가: tick은 마운트 시 한 번 만들어지고(deps=[workspaceId]) 그 안에서
   * schedule을 부른다. schedule이 state인 remaining을 읽으면 tick이 붙잡은 것은
   * **첫 렌더의 schedule**, 즉 remaining=0인 클로저다. 그래서 큐에 202건이 남아 있어도
   * 간격이 영원히 idle(45초)로 계산됐다 — 실측 v0.7.565: 드레인 1회 6건·3초인데
   * 20초에 1회만 호출되어 처리량이 분당 8건이었다(정상이면 분당 100건 이상).
   * 사용자가 "링크를 넣었는데 계속 수집 중"으로 겪은 지연의 실제 크기가 이것이다.
   */
  const remainingRef = useRef(0)
  /** 최신 schedule을 가리킨다 — tick이 옛 클로저를 부르지 않게 하는 유일한 통로 */
  const scheduleRef = useRef<() => void>(() => {})

  const tick = useCallback(async () => {
    if (stopped.current || inFlight.current) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

    inFlight.current = true
    try {
      const res = await fetch('/api/ci/queue/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: '{}',
      }).then((r) => r.json() as Promise<ApiResponse<DrainResponse>>)

      if (!res.success) throw new Error(res.error.message)

      errors.current = 0

      // 서버가 문턱(1.5초)에 걸어 돌려보낸 경우다. **일이 없다는 뜻이 아니다.**
      // 이 응답에는 남은 잡 수가 없으므로(remaining=null) 0으로 읽으면 안 된다 —
      // 그러면 '큐가 비었다'로 판단해 45초를 자고, 그동안 잡이 그대로 쌓인다.
      // 탭을 두 개 열면 서로를 이 상태로 밀어내 상시화된다(실측: 처리량 1/20).
      if (res.data.skipped === 'too_soon') {
        throttled.current = true
        return
      }
      throttled.current = false

      const left = res.data.remaining ?? 0
      // 비어 있음을 확인한 시각을 남긴다 — 다음 화면에서 다시 묻지 않기 위해
      lastIdleAt = left > 0 ? 0 : Date.now()
      remainingRef.current = left
      setRemaining(left)
      setPhase(left > 0 ? 'working' : 'idle')
    } catch {
      errors.current += 1
      // 한도를 넘으면 멈추되 화면에 남긴다 — 조용한 정지가 이 시스템의 원래 병이었다
      if (errors.current >= DRIVER_MAX_ERRORS) {
        stopped.current = true
        setPhase('stalled')
      }
    } finally {
      inFlight.current = false
      // **ref를 거쳐 부른다.** 직접 부르면 첫 렌더의 schedule에 갇힌다(위 remainingRef 주석).
      scheduleRef.current()
    }
  }, [workspaceId])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (stopped.current) return
    const delay = nextDriverDelayMs({
      // state가 아니라 ref를 읽는다 — 이 함수는 tick의 옛 클로저에서도 불릴 수 있다
      remaining: remainingRef.current,
      consecutiveErrors: errors.current,
      throttled: throttled.current,
    })
    if (delay === null) return
    timer.current = setTimeout(() => { void tick() }, delay)
  }, [tick])

  // 매 렌더마다 최신 schedule을 꽂는다
  scheduleRef.current = schedule

  useEffect(() => {
    // 화면에 들어오는 순간 한 번 — 링크를 넣고 바로 결과를 보려면 첫 틱이 즉시여야 한다.
    // 단 **방금 비어 있다고 확인했으면** 묻지 않는다(화면 전환마다 되묻는 것을 막는다).
    // 링크 투입은 이 경로를 타지 않는다 — LinkIntakeBox가 접수 직후 새로고침을 걸고,
    // 그때 remaining>0이 되어 lastIdleAt이 풀린다.
    const justIdle = Date.now() - lastIdleAt < IDLE_REMOUNT_GRACE_MS
    if (!justIdle) void tick()
    else schedule()

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped.current) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
    // 마운트 시 1회만 건다. 이후 순환은 tick이 스스로 예약한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'idle') return null

  // 칩은 **누를 수 있어야 한다.** 숫자 하나로는 무엇을 하는 중인지·언제 끝나는지·
  // 뭔가 막혔는지를 알 수 없다. 사용자는 실제로 눌러 보려 했다(지적 2026-08-18).
  const label = phase === 'stalled'
    ? '수집이 멈춰 있습니다'
    : `수집 중 ${remaining.toLocaleString()}건 남음`

  return (
    <>
      <button
        type="button"
        className={`ci-status ${phase === 'stalled' ? 'ci-status-danger' : 'ci-status-info'} ${styles.chip}`}
        onClick={() => setPanelOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        title="눌러서 진행 상황 보기"
      >
        {phase === 'stalled'
          ? <AlertTriangle size={14} aria-hidden="true" />
          : <AXDotLoader size={5} />}
        {label}
      </button>
      {/* 상태를 읽어 주는 것은 버튼이 아니라 이 줄이다 —
          버튼에 aria-live를 걸면 누를 때마다 다시 읽어 시끄럽다 */}
      <span className="visually-hidden" role="status" aria-live="polite">{label}</span>

      <QueueProgressPanel
        isOpen={panelOpen}
        onClose={closePanel}
        workspaceId={workspaceId}
      />
    </>
  )
}
