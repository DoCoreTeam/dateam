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

export default function QueueDriver({ workspaceId }: { workspaceId: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [remaining, setRemaining] = useState(0)

  // 렌더와 무관한 구동 상태는 ref로 둔다 — 상태로 두면 매 틱마다 effect가 재생성된다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const errors = useRef(0)
  const stopped = useRef(false)

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
      const left = res.data.remaining ?? 0
      // 비어 있음을 확인한 시각을 남긴다 — 다음 화면에서 다시 묻지 않기 위해
      lastIdleAt = left > 0 ? 0 : Date.now()
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
      schedule()
    }
    // schedule은 아래에서 정의되며 ref만 읽으므로 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (stopped.current) return
    const delay = nextDriverDelayMs({
      remaining,
      consecutiveErrors: errors.current,
    })
    if (delay === null) return
    timer.current = setTimeout(() => { void tick() }, delay)
  }, [remaining, tick])

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

  if (phase === 'stalled') {
    return (
      <span className="ci-status ci-status-danger" role="status" aria-live="polite">
        <AlertTriangle size={14} aria-hidden="true" />
        수집이 멈춰 있습니다
      </span>
    )
  }

  return (
    <span className="ci-status ci-status-info" role="status" aria-live="polite">
      <AXDotLoader size={5} />
      수집 중 {remaining}건 남음
    </span>
  )
}
