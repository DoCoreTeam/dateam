'use client'

/**
 * 필드 확정 상태 훅 (dacrm 정정판, 절대규칙 2)
 *
 * 회사·인물·딜 상세가 **같은 방식으로** 확정 토글을 쓰게 하려고 훅으로 뺐다.
 * 화면마다 따로 만들면 어떤 상세에는 토글이 있고 어떤 상세에는 없게 되고,
 * 그러면 사용자는 "왜 여기선 안 되지"를 겪는다.
 *
 * **낙관적으로 먼저 반영한다.** 자물쇠를 눌렀는데 반응이 늦으면 사람은 두 번 누른다.
 * 실패하면 되돌리고 이유를 말한다 — 조용히 원래대로 돌아가면 눌린 줄 알고 넘어간다.
 */

import { useCallback, useEffect, useState } from 'react'

export interface VerifiedState {
  /** 지금 확정된 필드들 */
  verified: string[]
  /** 이 화면에서 잠글 수 있는 필드들 — 못 잠그는 칸에 토글을 그리면 오해를 부른다 */
  verifiable: string[]
  /** 실패 이유. 화면이 배너로 보여 준다 */
  error: string | null
  toggle: (field: string, next: boolean) => void
}

export function useVerified(targetType: 'company' | 'person' | 'deal', targetId: string): VerifiedState {
  const [verified, setVerified] = useState<string[]>([])
  const [verifiable, setVerifiable] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/verify?targetType=${targetType}&targetId=${targetId}`)
      if (!res.ok) return
      const body = await res.json()
      setVerified(body.verifiedFields ?? [])
      setVerifiable(body.verifiable ?? [])
    } catch {
      // 확정 상태를 못 읽어도 레코드 본문은 보여야 한다 — 곁들이는 일이 본 일을 막지 않는다
    }
  }, [targetType, targetId])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback((field: string, next: boolean) => {
    const before = verified
    // 먼저 반영 — 자물쇠가 늦게 움직이면 사람은 두 번 누른다
    setVerified(next ? [...before, field] : before.filter((f) => f !== field))
    setError(null)

    void (async () => {
      try {
        const res = await fetch('/api/crm/verify', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetId, field, verified: next }),
        })
        const body = await res.json()
        if (!res.ok) {
          setVerified(before)
          setError(body?.error?.message ?? '확정 상태를 바꾸지 못했습니다.')
          return
        }
        setVerified(body.verifiedFields ?? [])
      } catch {
        setVerified(before)
        setError('확정 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }
    })()
  }, [targetType, targetId, verified])

  return { verified, verifiable, error, toggle }
}
