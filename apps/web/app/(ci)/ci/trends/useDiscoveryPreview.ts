'use client'

// 누르기 전에 «AI에 새로 물을 것 몇 건»을 센다 (P0030 I17b)
// 숫자를 모르고 다시 계산을 누르면 매번 도박이다. 세기는 서버가 AI 없이 한다.

import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse } from '@/lib/ci/contracts'

/** 세는 중 · 셌음 · 못 셈. 못 센 것을 0건으로 위장하지 않는다 */
export type DiscoveryPreview =
  | { state: 'loading' }
  | { state: 'ready'; fresh: number; cached: number }
  | { state: 'failed' }

export function useDiscoveryPreview(
  workspaceId: string,
  topicId: string | null,
  enabled: boolean,
): { preview: DiscoveryPreview; recount: () => void } {
  const [preview, setPreview] = useState<DiscoveryPreview>({ state: 'loading' })
  const [round, setRound] = useState(0)
  const recount = useCallback(() => setRound((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    setPreview({ state: 'loading' })
    const qs = topicId ? `?topicId=${encodeURIComponent(topicId)}` : ''
    // 경로를 리터럴로 둔다 — 템플릿으로 조립하면 배선 가드가 이 호출을 못 본다
    fetch('/api/ci/patterns/recompute' + qs, { headers: { 'X-CI-Workspace': workspaceId } })
      .then((r) => r.json() as Promise<ApiResponse<{ fresh: number; cached: number }>>)
      .then((res) => {
        if (!alive) return
        setPreview(res.success
          ? { state: 'ready', fresh: res.data.fresh, cached: res.data.cached }
          : { state: 'failed' })
      })
      .catch(() => { if (alive) setPreview({ state: 'failed' }) })
    return () => { alive = false }
  }, [workspaceId, topicId, enabled, round])

  return { preview, recount }
}

/** 단추 옆 한 줄 */
export function discoveryPreviewText(p: DiscoveryPreview): string {
  if (p.state === 'loading') return 'AI에 새로 물을 것을 세는 중'
  if (p.state === 'failed') return 'AI에 새로 물을 것을 못 셌습니다'
  if (p.fresh === 0) return '새로 물을 것 없음, AI를 안 부릅니다'
  return `AI에 새로 물을 것 ${p.fresh}건`
}
